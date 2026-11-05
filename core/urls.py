"""
URL configuration for core project.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.contrib.auth.decorators import login_required
from django.urls import include, path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

catalog_view = ensure_csrf_cookie(
    TemplateView.as_view(
        template_name='index.html',
        extra_context={
            'whatsapp_number': settings.STORE_WHATSAPP,
            'store_name': settings.STORE_NAME,
        },
    )
)

crm_view = ensure_csrf_cookie(
    login_required(TemplateView.as_view(template_name='crm.html'))
)

urlpatterns = [
    path('admin/', admin.site.urls),

    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),

    path('api/v1/', include('apps.store.urls')),

    path('', catalog_view, name='catalog'),

    path(
        'crm/login/',
        auth_views.LoginView.as_view(
            template_name='crm_login.html',
            redirect_authenticated_user=True,
        ),
        name='crm_login',
    ),
    path(
        'crm/logout/',
        auth_views.LogoutView.as_view(next_page='crm_login'),
        name='crm_logout',
    ),
    path('crm/', crm_view, name='crm'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
