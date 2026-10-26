package com.vajravyuha.atlas;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ScanErrorResponse> handleValidationError(
            MethodArgumentNotValidException ex) {

        String message = ex.getBindingResult()
                .getFieldErrors()
                .stream()
                .findFirst()
                .map(error -> error.getDefaultMessage())
                .orElse("Invalid request");

        return errorResponse(
                HttpStatus.BAD_REQUEST,
                "INVALID_REQUEST",
                message,
                null
        );
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ScanErrorResponse> handleUnreadableRequest(
            HttpMessageNotReadableException ex) {

        return errorResponse(
                HttpStatus.BAD_REQUEST,
                "INVALID_REQUEST",
                "Request body is missing or invalid JSON",
                null
        );
    }

    @ExceptionHandler(ScanException.class)
public ResponseEntity<ScanErrorResponse> handleScanError(
        ScanException ex) {

    HttpStatus status;

    switch (ex.getErrorCode()) {
        case "INVALID_REQUEST":
            status = HttpStatus.BAD_REQUEST;
            break;

        case "IMAGE_NOT_FOUND":
            status = HttpStatus.NOT_FOUND;
            break;

        case "IMAGE_UNSCANNABLE":
            status = HttpStatus.UNPROCESSABLE_ENTITY;
            break;

        case "SCAN_TIMEOUT":
            status = HttpStatus.GATEWAY_TIMEOUT;
            break;

        default:
            status = HttpStatus.INTERNAL_SERVER_ERROR;
            break;
    }

    ScanErrorResponse response = new ScanErrorResponse(
            ex.getErrorCode(),
            ex.getMessage(),
            ex.getDeployId()
    );

    return ResponseEntity.status(status).body(response);
}

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ScanErrorResponse> handleUnexpectedError(
            Exception ex) {

        return errorResponse(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "An unexpected server error occurred",
                null
        );
    }

    private ResponseEntity<ScanErrorResponse> errorResponse(
            HttpStatus status,
            String error,
            String message,
            String deployId) {

        ScanErrorResponse response = new ScanErrorResponse(
                error,
                message,
                deployId
        );

        return ResponseEntity.status(status).body(response);
    }
}