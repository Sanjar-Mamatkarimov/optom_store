from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import SAFE_METHODS, AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.store.models import (
    Category, Order, OrderItem, Product, Stock, StockOperation,
)
from apps.store.serializers import (
    CategorySerializer,
    OrderCreateSerializer,
    OrderItemSerializer,
    OrderSerializer,
    OrderStatusSerializer,
    ProductSerializer,
    StockOperationSerializer,
    StockSupplySerializer,
)


def money(value):
    return float(value or 0)


def product_queryset():
    return (
        Product.objects.select_related('category')
        .annotate(stock_quantity=Coalesce('stock__quantity', Value(0)))
    )


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    pagination_class = None

    def get_queryset(self):
        return Category.objects.annotate(products_count=Count('products')).order_by('name')

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [AllowAny()]
        return [IsAuthenticated()]


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    pagination_class = None

    def get_queryset(self):
        qs = product_queryset()

        if self.action == 'list':
            include_inactive = self.request.query_params.get('include_inactive') in (
                '1', 'true', 'True', 'yes',
            )
            if not include_inactive:
                qs = qs.filter(is_active=True)

            category = self.request.query_params.get('category')
            if category and category != 'all':
                if str(category).isdigit():
                    qs = qs.filter(Q(category_id=int(category)) | Q(category__slug=category))
                else:
                    qs = qs.filter(category__slug=category)

            search = self.request.query_params.get('search')
            if search:
                qs = qs.filter(name__icontains=search.strip())

        return qs.order_by('name')

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [AllowAny()]
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Товар нельзя удалить: он используется в заказах. Сделайте его неактивным."},
                status=status.HTTP_400_BAD_REQUEST,
            )


class OrderViewSet(viewsets.ModelViewSet):
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    pagination_class = None

    def get_queryset(self):
        qs = (
            Order.objects.prefetch_related('items__product')
            .order_by('-created_at')
        )
        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            qs = qs.filter(status=status_filter)
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return OrderCreateSerializer
        return OrderSerializer

    def get_permissions(self):
        if self.action == 'create':
            return [AllowAny()]
        return [IsAuthenticated()]

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        order = Order.objects.create(
            customer_name=data.get('customer_name', ''),
            customer_phone=data.get('customer_phone', ''),
            status=Order.STATUS_NEW,
        )

        total_amount = Decimal('0')
        total_cost = Decimal('0')

        for item in data['items']:
            try:
                product = Product.objects.select_for_update().get(
                    id=item['product_id'], is_active=True,
                )
            except Product.DoesNotExist:
                raise ValidationError({
                    "detail": f"Товар с ID {item['product_id']} не найден или снят с продажи.",
                })

            qty = item['quantity']
            stock, _ = Stock.objects.get_or_create(product=product)

            if stock.quantity < qty:
                raise ValidationError({
                    "detail": (
                        f"Недостаточно товара «{product.name}» на складе. "
                        f"Доступно: {stock.quantity} {product.unit}."
                    ),
                })

            price_per_item = product.get_price_for_quantity(qty)
            cost_per_item = product.cost_price

            OrderItem.objects.create(
                order=order,
                product=product,
                quantity=qty,
                price_per_item=price_per_item,
                cost_price_per_item=cost_per_item,
            )

            stock.quantity -= qty
            stock.save(update_fields=['quantity'])

            StockOperation.objects.create(
                product=product,
                operation_type=StockOperation.OPERATION_OUT,
                quantity=qty,
                cost_price=cost_per_item,
                comment=f"Заказ №{order.id}",
            )

            total_amount += price_per_item * qty
            total_cost += cost_per_item * qty

        order.total_amount = total_amount
        order.total_cost = total_cost
        order.profit = total_amount - total_cost
        order.save(update_fields=['total_amount', 'total_cost', 'profit'])

        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)

    def _move_stock(self, order, direction, operation_type, prefix):
        """direction = +1 (вернуть на склад) или -1 (списать со склада)."""
        for item in order.items.select_related('product'):
            stock, _ = Stock.objects.get_or_create(product=item.product)
            if direction < 0 and stock.quantity < item.quantity:
                raise ValidationError({
                    "detail": (
                        f"Недостаточно товара «{item.product.name}» на складе, "
                        f"чтобы вернуть заказ в работу. Доступно: {stock.quantity}."
                    ),
                })
            stock.quantity += direction * item.quantity
            stock.save(update_fields=['quantity'])

            StockOperation.objects.create(
                product=item.product,
                operation_type=operation_type,
                quantity=item.quantity,
                cost_price=item.cost_price_per_item,
                comment=f"{prefix} заказа №{order.id}",
            )

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        order = self.get_object()
        serializer = OrderStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']

        if new_status != order.status:
            if new_status == Order.STATUS_CANCELLED:
                self._move_stock(
                    order, +1, StockOperation.OPERATION_IN, "Отмена",
                )
            elif order.status == Order.STATUS_CANCELLED:
                self._move_stock(
                    order, -1, StockOperation.OPERATION_OUT, "Возврат в работу",
                )

            order.status = new_status
            order.save(update_fields=['status'])

        return Response(OrderSerializer(order).data)


class CRMViewSet(viewsets.ViewSet):
    """Панель управления и аналитики"""
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'], url_path='supply')
    @transaction.atomic
    def add_supply(self, request):
        """Приход товара на склад (поставка)"""
        serializer = StockSupplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            product = Product.objects.select_for_update().get(
                id=serializer.validated_data['product_id'],
            )
        except Product.DoesNotExist:
            raise ValidationError({"detail": "Товар не найден."})

        qty = serializer.validated_data['quantity']
        cost_price = serializer.validated_data['cost_price']
        comment = serializer.validated_data.get('comment') or 'Поставка'

        stock, _ = Stock.objects.get_or_create(product=product)
        stock.quantity += qty
        stock.save(update_fields=['quantity'])

        product.cost_price = cost_price
        product.save(update_fields=['cost_price'])

        StockOperation.objects.create(
            product=product,
            operation_type=StockOperation.OPERATION_IN,
            quantity=qty,
            cost_price=cost_price,
            comment=comment,
        )

        return Response({
            "message": "Приход оформлен",
            "new_stock": stock.quantity,
            "product_name": product.name,
        })

    @action(detail=False, methods=['get'], url_path='operations')
    def operations(self, request):
        """История движений товаров"""
        qs = StockOperation.objects.select_related('product').order_by('-created_at')
        op_type = request.query_params.get('type')
        if op_type in (StockOperation.OPERATION_IN, StockOperation.OPERATION_OUT):
            qs = qs.filter(operation_type=op_type)
        limit = request.query_params.get('limit')
        try:
            limit = min(max(int(limit), 1), 500) if limit else 100
        except (TypeError, ValueError):
            limit = 100
        return Response(StockOperationSerializer(qs[:limit], many=True).data)

    @action(detail=False, methods=['get'], url_path='dashboard')
    def dashboard(self, request):
        """Финансовые метрики CRM (Выручка, Себестоимость, Чистая прибыль)"""
        today = timezone.localdate()
        valid_orders = Order.objects.exclude(status=Order.STATUS_CANCELLED)

        totals = valid_orders.aggregate(
            revenue=Sum('total_amount'),
            cost=Sum('total_cost'),
            profit=Sum('profit'),
            orders=Count('id'),
        )
        today_totals = valid_orders.filter(created_at__date=today).aggregate(
            revenue=Sum('total_amount'),
            profit=Sum('profit'),
            orders=Count('id'),
        )

        revenue = totals['revenue'] or Decimal('0')
        orders_count = totals['orders'] or 0
        avg_check = revenue / orders_count if orders_count else Decimal('0')

        status_counts = {
            row['status']: row['n']
            for row in Order.objects.values('status').annotate(n=Count('id'))
        }
        statuses = [
            {
                'value': value,
                'label': label,
                'count': status_counts.get(value, 0),
            }
            for value, label in Order.STATUS_CHOICES
        ]

        low_stock = list(
            Product.objects.filter(is_active=True)
            .annotate(qty=Coalesce('stock__quantity', Value(0)))
            .filter(qty__lt=5)
            .order_by('qty')
            .values('id', 'name', 'unit', 'qty')[:10]
        )

        start = today - timedelta(days=29)
        chart_rows = (
            valid_orders.filter(created_at__date__range=(start, today))
            .annotate(day=TruncDate('created_at'))
            .values('day')
            .annotate(revenue=Sum('total_amount'), profit=Sum('profit'))
            .order_by('day')
        )
        chart_map = {row['day']: row for row in chart_rows}
        sales_chart = []
        for offset in range(30):
            day = start + timedelta(days=offset)
            row = chart_map.get(day)
            sales_chart.append({
                'date': day.isoformat(),
                'revenue': money(row['revenue']) if row else 0,
                'profit': money(row['profit']) if row else 0,
            })

        revenue_expr = ExpressionWrapper(
            F('quantity') * F('price_per_item'),
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )
        top_products = list(
            OrderItem.objects.exclude(order__status=Order.STATUS_CANCELLED)
            .values('product__name', 'product__unit')
            .annotate(qty=Sum('quantity'), revenue=Sum(revenue_expr))
            .order_by('-qty')[:5]
        )
        for row in top_products:
            row['revenue'] = money(row['revenue'])

        recent_orders = OrderSerializer(
            Order.objects.prefetch_related('items').order_by('-created_at')[:5],
            many=True,
        ).data

        return Response({
            "metrics": {
                "total_revenue": money(revenue),
                "total_cost": money(totals['cost']),
                "total_profit": money(totals['profit']),
                "orders_count": orders_count,
                "avg_check": money(avg_check),
                "today_revenue": money(today_totals['revenue']),
                "today_profit": money(today_totals['profit']),
                "today_orders": today_totals['orders'] or 0,
            },
            "statuses": statuses,
            "low_stock": low_stock,
            "sales_chart": sales_chart,
            "top_products": top_products,
            "recent_orders": recent_orders,
        })
