package com.vajravyuha.atlas;

public class ScanErrorResponse {

    private final String error;
    private final String message;
    private final String deployId;

    public ScanErrorResponse(
            String error,
            String message,
            String deployId) {

        this.error = error;
        this.message = message;
        this.deployId = deployId;
    }

    public String getError() {
        return error;
    }

    public String getMessage() {
        return message;
    }

    public String getDeployId() {
        return deployId;
    }
}