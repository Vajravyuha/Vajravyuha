package com.vajravyuha.atlas;

public class ScanException extends RuntimeException {

    private final String errorCode;
    private final String deployId;

    public ScanException(String message) {
        this("INTERNAL_ERROR", message, null);
    }

    public ScanException(
            String errorCode,
            String message,
            String deployId) {

        super(message);
        this.errorCode = errorCode;
        this.deployId = deployId;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getDeployId() {
        return deployId;
    }
}