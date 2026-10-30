package com.vajravyuha.atlas;

public interface ScanService {

    ScanResult scanApplication(String appName, String environment);

    ScanResult scanImage(
            String deployId,
            String appName,
            String environment,
            String image
    );
}