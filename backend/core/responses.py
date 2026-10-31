import logging

from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def success_response(data=None, message="OK", status_code=status.HTTP_200_OK):
    return Response({"success": True, "message": message, "data": data}, status=status_code)


def error_response(message, errors=None, status_code=status.HTTP_400_BAD_REQUEST):
    return Response({"success": False, "message": message, "errors": errors}, status=status_code)


class UpstreamError(APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = "An upstream service failed."


def api_exception_handler(exc, context):
    if isinstance(exc, ValidationError):
        return error_response("Validation failed", exc.detail, status.HTTP_400_BAD_REQUEST)

    response = exception_handler(exc, context)
    if response is not None:
        return error_response(str(response.data.get("detail", exc)), status_code=response.status_code)

    logger.exception("Unhandled error", exc_info=exc)
    return error_response("Internal server error", status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
