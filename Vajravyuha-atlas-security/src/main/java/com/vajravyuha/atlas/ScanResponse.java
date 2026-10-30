package com.vajravyuha.atlas;

public class ScanResponse {

    private String deployId;
    private String appName;
    private String environment;
    private String status;

    private int criticalCount;
    private int highCount;
    private int mediumCount;
    private int lowCount;

    private String message;

    public ScanResponse(
            String deployId,
            String appName,
            String environment,
            String status,
            int criticalCount,
            int highCount,
            int mediumCount,
            int lowCount,
            String message) {

        this.deployId = deployId;
        this.appName = appName;
        this.environment = environment;
        this.status = status;
        this.criticalCount = criticalCount;
        this.highCount = highCount;
        this.mediumCount = mediumCount;
        this.lowCount = lowCount;
        this.message = message;
    }

    public String getDeployId() {
        return deployId;
    }

    public String getAppName() {
        return appName;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getStatus() {
        return status;
    }

    public int getCriticalCount() {
        return criticalCount;
    }

    public int getHighCount() {
        return highCount;
    }

    public int getMediumCount() {
        return mediumCount;
    }

    public int getLowCount() {
        return lowCount;
    }

    public String getMessage() {
        return message;
    }
}