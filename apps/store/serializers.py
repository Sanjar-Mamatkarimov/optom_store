from django.db import transaction
from django.utils.text import slugify
from rest_framework import serializers

from apps.store.models import (
    Category, Product, Stock, StockOperation, Order, OrderItem,
)


class CategorySerializer(serializers.ModelSerializer):
    products_count = serializers.IntegerField(read_only=True)
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = Category
        fields = ['id', 'name', 'slug', 'products_count']

    def _unique_slug(self, name, instance=None):
        base = slugify(name) or slugify(name, allow_unicode=True) or 'category'
        slug = base
        index = 2
        qs = Category.objects.all()
        if instance:
            qs = qs.exclude(pk=instance.pk)
        while qs.filter(slug=slug).exists():
            slug = f"{base}-{index}"
            index += 1
        return slug

    def create(self, validated_data):
        if not validated_data.get('slug'):
            validated_data['slug'] = self._unique_slug(validated_data['name'])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        slug = validated_data.get('slug')
        if slug:
            validated_data['slug'] = self._unique_slug(slug, instance)
        elif 'name' in validated_data and not instance.slug:
            validated_data['slug'] = self._unique_slug(validated_data['name'], instance)
        return super().update(instance, validated_data)


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    category_slug = serializers.CharField(source='category.slug', read_only=True)
    image_src = serializers.SerializerMethodField()
    stock_quantity = serializers.IntegerField(required=False, min_value=0, max_value=1_000_000)

    class Meta:
        model = Product
        fields = [
            'id', 'category', 'category_name', 'category_slug', 'name',
            'image', 'image_url', 'image_src', 'unit',
            'retail_price', 'wholesale_price', 'min_wholesale_qty',
            'cost_price', 'stock_quantity', 'is_active',
        ]
        extra_kwargs = {
            'image': {'required': False, 'allow_null': True},
            'image_url': {'required': False, 'allow_null': True, 'allow_blank': True},
        }

    def get_image_src(self, obj):
        if obj.image:
            url = obj.image.url
            request = self.context.get('request')
            return request.build_absolute_uri(url) if request else url
        return obj.image_url or ''

    def _sync_stock(self, product, quantity):
        if quantity is None:
            return
        stock, _ = Stock.objects.get_or_create(product=product)
        stock.quantity = quantity
        stock.save(update_fields=['quantity'])
        product.stock_quantity = quantity

    @transaction.atomic
    def create(self, validated_data):
        quantity = validated_data.pop('stock_quantity', 0)
        product = super().create(validated_data)
        self._sync_stock(product, quantity)
        return product

    @transaction.atomic
    def update(self, instance, validated_data):
        quantity = validated_data.pop('stock_quantity', None)
        product = super().update(instance, validated_data)
        self._sync_stock(product, quantity)
        return product


class StockOperationSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    operation_display = serializers.CharField(source='get_operation_type_display', read_only=True)

    class Meta:
        model = StockOperation
        fields = [
            'id', 'product', 'product_name', 'operation_type', 'operation_display',
            'quantity', 'cost_price', 'created_at', 'comment',
        ]


class OrderItemCreateSerializer(serializers.Serializer):
    product_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1, max_value=100_000)


class OrderCreateSerializer(serializers.Serializer):
    items = OrderItemCreateSerializer(many=True, allow_empty=False)
    customer_name = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    customer_phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default='')


class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_unit = serializers.CharField(source='product.unit', read_only=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            'id', 'product', 'product_name', 'product_unit', 'quantity',
            'price_per_item', 'cost_price_per_item', 'total',
        ]

    def get_total(self, obj):
        return obj.price_per_item * obj.quantity


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            'id', 'status', 'status_display', 'customer_name', 'customer_phone',
            'total_amount', 'total_cost', 'profit', 'created_at', 'items_count', 'items',
        ]

    def get_items_count(self, obj):
        return sum(item.quantity for item in obj.items.all())


class OrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Order.STATUS_CHOICES)


class StockSupplySerializer(serializers.Serializer):
    product_id = serializers.IntegerField()
    quantity = serializers.IntegerField(min_value=1, max_value=100_000)
    cost_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=255)
