package com.vajravyuha.atlas;

import jakarta.validation.constraints.NotBlank;

public class ScanRequest {

    @NotBlank(message = "Deployment ID is required")
    private String deployId;

    @NotBlank(message = "Application name is required")
    private String appName;

    @NotBlank(message = "Environment is required")
    private String environment;

    @NotBlank(message = "Container image is required")
    private String image;

    @NotBlank(message = "Commit SHA is required")
    private String commitSha;

    @NotBlank(message = "Requested by is required")
    private String requestedBy;

    public ScanRequest() {
    }

    public String getDeployId() {
        return deployId;
    }

    public void setDeployId(String deployId) {
        this.deployId = deployId;
    }

    public String getAppName() {
        return appName;
    }

    public void setAppName(String appName) {
        this.appName = appName;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getImage() {
        return image;
    }

    public void setImage(String image) {
        this.image = image;
    }

    public String getCommitSha() {
        return commitSha;
    }

    public void setCommitSha(String commitSha) {
        this.commitSha = commitSha;
    }

    public String getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(String requestedBy) {
        this.requestedBy = requestedBy;
    }
}