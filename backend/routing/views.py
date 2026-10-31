from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from core.responses import error_response, success_response

from .models import TripSearch
from .planner import plan_trip
from .serializers import (
    CredentialsSerializer,
    GeocodeQuerySerializer,
    RegisterSerializer,
    TripRequestSerializer,
    TripSearchDetailSerializer,
    TripSearchSerializer,
    UserSerializer,
)
from .services import geocode

MAX_HISTORY = 50


def auth_payload(user):
    token, _ = Token.objects.get_or_create(user=user)
    return {"token": token.key, "user": UserSerializer(user).data}


class PublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class HealthView(PublicView):
    throttle_classes = []

    def get(self, request):
        return success_response({"status": "ok"})


class RegisterView(PublicView):
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email, password = serializer.validated_data["email"], serializer.validated_data["password"]
        user = User.objects.create_user(username=email, email=email, password=password)
        return success_response(auth_payload(user), "Account created", status.HTTP_201_CREATED)


class LoginView(PublicView):
    def post(self, request):
        serializer = CredentialsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(username=serializer.validated_data["email"], password=serializer.validated_data["password"])
        if user is None:
            return error_response("Invalid email or password.", status_code=status.HTTP_401_UNAUTHORIZED)
        return success_response(auth_payload(user), "Logged in")


class LogoutView(APIView):
    def post(self, request):
        request.auth.delete()
        return success_response(message="Logged out")


class MeView(APIView):
    def get(self, request):
        return success_response(UserSerializer(request.user).data)


class GeocodeView(APIView):
    def get(self, request):
        query = GeocodeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return success_response(geocode(query.validated_data["q"]))


class PlanTripView(APIView):
    def post(self, request):
        serializer = TripRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        plan = plan_trip(data["origin"], data["destination"], data["departure"], data["load_weight_lb"])
        best = plan["routes"][0]
        TripSearch.objects.create(
            user=request.user,
            origin=data["origin"],
            destination=data["destination"],
            departure=data["departure"],
            load_weight_lb=data["load_weight_lb"],
            summary={
                "distance_miles": best["distance_miles"],
                "duration_seconds": best["duration_seconds"],
                "worst_level": best["worst_level"],
                "route_count": len(plan["routes"]),
                "reason": plan["recommendation_reason"],
            },
            result=plan,
        )
        stale = list(request.user.trip_searches.values_list("pk", flat=True)[MAX_HISTORY:])
        TripSearch.objects.filter(pk__in=stale).delete()
        return success_response(plan, "Trip planned")


class HistoryListView(APIView):
    def get(self, request):
        searches = request.user.trip_searches.defer("result")[:MAX_HISTORY]
        return success_response(TripSearchSerializer(searches, many=True).data)


class HistoryDetailView(APIView):
    def get(self, request, pk):
        search = get_object_or_404(request.user.trip_searches, pk=pk)
        return success_response(TripSearchDetailSerializer(search).data)

    def delete(self, request, pk):
        get_object_or_404(request.user.trip_searches, pk=pk).delete()
        return success_response(message="Deleted")
