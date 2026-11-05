from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.store.models import Category, Product, Stock

CATEGORIES = [
    ('Бакалея', 'bakaleya'),
    ('Напитки', 'napitki'),
    ('Сладости', 'sladosti'),
    ('Молочные', 'molochnye'),
    ('Консервы', 'konservy'),
    ('Снеки', 'sneki'),
]

# name, category slug, unit, retail, wholesale, min qty, cost, stock, image
PRODUCTS = [
    ('Рис высшего сорта', 'bakaleya', '1 кг', '95', '85', 10, '68', 60,
     'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=700&q=80'),
    ('Макароны', 'bakaleya', '500 г', '75', '67', 10, '52', 30,
     'https://images.unsplash.com/photo-1551892374-ecf8754cf8b0?auto=format&fit=crop&w=700&q=80'),
    ('Сахар', 'bakaleya', '1 кг', '78', '70', 10, '55', 45,
     'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?auto=format&fit=crop&w=700&q=80'),
    ('Чай чёрный', 'bakaleya', '100 пакетиков', '145', '130', 10, '105', 18,
     'https://images.unsplash.com/photo-1594631252845-29fc4cc8cde9?auto=format&fit=crop&w=700&q=80'),
    ('Минеральная вода', 'napitki', '1.5 л', '45', '38', 20, '25', 120,
     'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=700&q=80'),
    ('Апельсиновый сок', 'napitki', '1 л', '160', '145', 10, '118', 40,
     'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=700&q=80'),
    ('Молоко', 'molochnye', '1 л', '85', '76', 10, '62', 3,
     'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=700&q=80'),
    ('Шоколад молочный', 'sladosti', '100 г', '120', '108', 10, '86', 25,
     'https://images.unsplash.com/photo-1575377427642-087cf684f29d?auto=format&fit=crop&w=700&q=80'),
    ('Печенье шоколадное', 'sladosti', '300 г', '110', '98', 10, '78', 12,
     'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?auto=format&fit=crop&w=700&q=80'),
    ('Чипсы', 'sneki', '150 г', '100', '90', 10, '72', 4,
     'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=700&q=80'),
    ('Кукуруза консервированная', 'konservy', '340 г', '125', '112', 10, '95', 22,
     'https://images.unsplash.com/photo-1551754655-cd27e38d2076?auto=format&fit=crop&w=700&q=80'),
    ('Зелёный горошек', 'konservy', '400 г', '115', '103', 10, '88', 35,
     'https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&w=700&q=80'),
]


class Command(BaseCommand):
    help = 'Заполняет базу демо-категориями и товарами (идемпотентно)'

    @transaction.atomic
    def handle(self, *args, **options):
        categories = {}
        for name, slug in CATEGORIES:
            category, _ = Category.objects.get_or_create(
                slug=slug, defaults={'name': name},
            )
            categories[slug] = category

        created = 0
        for name, slug, unit, retail, wholesale, min_qty, cost, qty, image in PRODUCTS:
            product, was_created = Product.objects.get_or_create(
                name=name,
                defaults={
                    'category': categories[slug],
                    'unit': unit,
                    'retail_price': Decimal(retail),
                    'wholesale_price': Decimal(wholesale),
                    'min_wholesale_qty': min_qty,
                    'cost_price': Decimal(cost),
                    'image_url': image,
                    'is_active': True,
                },
            )
            if was_created:
                created += 1

            Stock.objects.get_or_create(product=product, defaults={'quantity': qty})

        self.stdout.write(self.style.SUCCESS(
            f'Готово: категорий — {len(categories)}, новых товаров — {created}.'
        ))
