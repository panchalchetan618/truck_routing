from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.HealthView.as_view()),
    path("auth/register/", views.RegisterView.as_view()),
    path("auth/login/", views.LoginView.as_view()),
    path("auth/logout/", views.LogoutView.as_view()),
    path("auth/me/", views.MeView.as_view()),
    path("geocode/", views.GeocodeView.as_view()),
    path("trips/plan/", views.PlanTripView.as_view()),
    path("trips/history/", views.HistoryListView.as_view()),
    path("trips/history/<int:pk>/", views.HistoryDetailView.as_view()),
]
