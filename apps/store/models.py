from django.db import models
from django.core.validators import MinValueValidator


class Category(models.Model):
    name = models.CharField(max_length=100, verbose_name="Название")
    slug = models.SlugField(unique=True)

    class Meta:
        verbose_name = "Категория"
        verbose_name_plural = "Категории"
        ordering = ['name']

    def __str__(self):
        return self.name


class Product(models.Model):
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='products')
    name = models.CharField(max_length=255, verbose_name="Наименование")
    image = models.ImageField(upload_to='products/', blank=True, null=True, verbose_name="Изображение")
    image_url = models.URLField(
        blank=True, null=True,
        verbose_name="Ссылка на изображение",
        help_text="Используется, если файл изображения не загружен",
    )
    unit = models.CharField(max_length=20, default='шт', verbose_name="Ед. измерения")

    retail_price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Розничная цена")
    wholesale_price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Оптовая цена")
    min_wholesale_qty = models.PositiveIntegerField(default=10, verbose_name="Мин. кол-во для опта")

    cost_price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Закупочная себестоимость")
    is_active = models.BooleanField(default=True, verbose_name="Активен")

    class Meta:
        verbose_name = "Товар"
        verbose_name_plural = "Товары"
        ordering = ['name']

    def get_price_for_quantity(self, quantity: int):
        """Автоматический выбор цены (опт или розница)"""
        if quantity >= self.min_wholesale_qty:
            return self.wholesale_price
        return self.retail_price

    def __str__(self):
        return self.name


class Stock(models.Model):
    """Складские остатки"""
    product = models.OneToOneField(Product, on_delete=models.CASCADE, related_name='stock')
    quantity = models.PositiveIntegerField(default=0, verbose_name="Остаток на складе")

    class Meta:
        verbose_name = "Остаток на складе"
        verbose_name_plural = "Остатки на складе"

    def __str__(self):
        return f"{self.product.name} — Остаток: {self.quantity}"


class StockOperation(models.Model):
    """История движений товаров (Приход / Расход для CRM)"""
    OPERATION_IN = 'IN'
    OPERATION_OUT = 'OUT'
    OPERATION_TYPES = [
        (OPERATION_IN, 'Приход (Поставка)'),
        (OPERATION_OUT, 'Расход (Продажа)'),
    ]

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='operations')
    operation_type = models.CharField(max_length=3, choices=OPERATION_TYPES, verbose_name="Тип операции")
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)], verbose_name="Количество")
    cost_price = models.DecimalField(max_digits=10, decimal_places=2, verbose_name="Себестоимость")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Дата")
    comment = models.CharField(max_length=255, blank=True, null=True, verbose_name="Комментарий")

    class Meta:
        verbose_name = "Движение товара"
        verbose_name_plural = "Движения товаров"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.get_operation_type_display()} — {self.product.name} x{self.quantity}"


class Order(models.Model):
    """Заказы клиентов"""
    STATUS_NEW = 'new'
    STATUS_PROCESSING = 'processing'
    STATUS_COMPLETED = 'completed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_NEW, 'Новый'),
        (STATUS_PROCESSING, 'В обработке'),
        (STATUS_COMPLETED, 'Завершён'),
        (STATUS_CANCELLED, 'Отменён'),
    ]

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW)
    customer_name = models.CharField(max_length=100, blank=True, default='', verbose_name="Имя клиента")
    customer_phone = models.CharField(max_length=30, blank=True, default='', verbose_name="Телефон клиента")
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0, verbose_name="Сумма продажи")
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0, verbose_name="Себестоимость заказа")
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0, verbose_name="Чистая прибыль")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Дата заказа")

    class Meta:
        verbose_name = "Заказ"
        verbose_name_plural = "Заказы"
        ordering = ['-created_at']

    def __str__(self):
        return f"Заказ №{self.id} — {self.total_amount} сом"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    price_per_item = models.DecimalField(max_digits=10, decimal_places=2)
    cost_price_per_item = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        verbose_name = "Позиция заказа"
        verbose_name_plural = "Позиции заказа"

    def __str__(self):
        return f"{self.product.name} × {self.quantity}"
