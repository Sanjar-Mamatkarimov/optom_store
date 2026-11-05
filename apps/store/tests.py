from datetime import datetime, time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.store.models import Order
from apps.store.views import CRMViewSet


class DashboardSalesChartTests(TestCase):
    def test_dashboard_returns_revenue_for_the_last_30_days(self):
        today = timezone.localdate()
        start = today - timedelta(days=29)
        user = get_user_model().objects.create_user(username='dashboard-test')

        included_orders = [
            Order.objects.create(total_amount=100, profit=20),
            Order.objects.create(total_amount=200, profit=40),
        ]
        excluded_orders = [
            Order.objects.create(total_amount=300, profit=60),
            Order.objects.create(
                status=Order.STATUS_CANCELLED,
                total_amount=400,
                profit=80,
            ),
        ]
        for order, day in zip(included_orders, (start, today)):
            Order.objects.filter(pk=order.pk).update(
                created_at=timezone.make_aware(datetime.combine(day, time(12))),
            )
        Order.objects.filter(pk=excluded_orders[0].pk).update(
            created_at=timezone.make_aware(
                datetime.combine(start - timedelta(days=1), time(12)),
            ),
        )
        Order.objects.filter(pk=excluded_orders[1].pk).update(
            created_at=timezone.make_aware(datetime.combine(today, time(12))),
        )

        request = APIRequestFactory().get('/api/v1/crm/dashboard/')
        force_authenticate(request, user=user)
        with patch('apps.store.views.timezone.localdate', return_value=today):
            response = CRMViewSet.as_view({'get': 'dashboard'})(request)

        chart = response.data['sales_chart']
        self.assertEqual(len(chart), 30)
        self.assertEqual(chart[0]['date'], start.isoformat())
        self.assertEqual(chart[-1]['date'], today.isoformat())
        self.assertEqual(chart[0]['revenue'], 100)
        self.assertEqual(chart[-1]['revenue'], 200)
