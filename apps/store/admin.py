from django.contrib import admin
from apps.store.models import Category, Product, Stock, StockOperation, Order, OrderItem

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'slug')
    prepopulated_fields = {'slug': ('name',)}


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'category', 'retail_price', 'wholesale_price', 'min_wholesale_qty', 'cost_price', 'is_active')
    list_filter = ('category', 'is_active')
    search_fields = ('name',)


@admin.register(Stock)
class StockAdmin(admin.ModelAdmin):
    list_display = ('product', 'quantity')
    search_fields = ('product__name',)


@admin.register(StockOperation)
class StockOperationAdmin(admin.ModelAdmin):
    list_display = ('product', 'operation_type', 'quantity', 'cost_price', 'created_at', 'comment')
    list_filter = ('operation_type', 'created_at')
    search_fields = ('product__name', 'comment')


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ('product', 'quantity', 'price_per_item', 'cost_price_per_item')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'total_amount', 'total_cost', 'profit', 'status', 'created_at')
    list_filter = ('status', 'created_at')
    inlines = [OrderItemInline]
    readonly_fields = ('total_amount', 'total_cost', 'profit', 'created_at')