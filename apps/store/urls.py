from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.store.views import CategoryViewSet, CRMViewSet, OrderViewSet, ProductViewSet

router = DefaultRouter()
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'products', ProductViewSet, basename='product')
router.register(r'orders', OrderViewSet, basename='order')
router.register(r'crm', CRMViewSet, basename='crm')

urlpatterns = [
    path('', include(router.urls)),
]
