package com.vajravyuha.atlas;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import jakarta.validation.Valid;

import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;


@RestController
public class AtlasStatusController {
    private final ScanService scanService;
    public AtlasStatusController(ScanService scanService){
        this.scanService=scanService;
    }

    @GetMapping("/atlas/status")
    public Map<String, String> getStatus() {
        return Map.of(
            "service", "Atlas",
            "status", "running"
        );
    }
    @GetMapping("/atlas/greet")
    public String greet(@RequestParam(defaultValue ="nonsense") String name){
        return "hello,"+name+"!welcome to atlas";
    }
    @GetMapping("/atlas/apps/{appname}")
    public String getApp(@PathVariable String appname) {
        return "requested application :"+appname;
    }
    @GetMapping("/atlas/apps")
    public String getAppByName(@RequestParam String name) {
        return "requested applicatin :"+name;
    }
    @GetMapping("/atlas/search")
    public String searchapp(@RequestParam(required = false) String name,@RequestParam(defaultValue="dev") String environment) {
        return "Application "+name+"environment"+environment;
    }
    @PostMapping("/atlas/scan")
    public ResponseEntity<ScanResponse> scanApplication(@Valid @RequestBody ScanRequest request) {

    String environment = request.getEnvironment();

    if (environment == null || environment.isBlank()) {
        environment = "development";
    }

    ScanResult result = scanService.scanApplication(
            request.getAppName(),
            environment
    );

    int criticalCount = result.getCriticalCount();
    int highCount = result.getHighCount();
    int mediumCount = result.getMediumCount();
    int lowCount = result.getLowCount();

    String status = criticalCount > 0 ? "BLOCKED" : "PASSED";

    String message = status.equals("BLOCKED")
            ? "Deployment blocked due to critical vulnerabilities"
            : "No critical vulnerabilities detected";

    ScanResponse response = new ScanResponse(
            request.getDeployId(),
            request.getAppName(),
            environment,
            status,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            message
        );
    return ResponseEntity.ok(response);
    }
    @PostMapping("/api/v1/scans")
    public ResponseEntity<ScanResponse> scanImage(@Valid @RequestBody ScanRequest request) {

    String environment = request.getEnvironment();

    if (environment == null || environment.isBlank()) {
        environment = "development";
    }

    ScanResult result = scanService.scanImage(
        request.getDeployId(),
        request.getAppName(),
        environment,
        request.getImage()
    );

    int criticalCount = result.getCriticalCount();
    int highCount = result.getHighCount();
    int mediumCount = result.getMediumCount();
    int lowCount = result.getLowCount();

    String status = criticalCount > 0 ? "BLOCKED" : "PASSED";

    String message = status.equals("BLOCKED")
            ? "Deployment blocked due to critical vulnerabilities"
            : "No critical vulnerabilities detected";

    ScanResponse response = new ScanResponse(
            request.getDeployId(),
            request.getAppName(),
            environment,
            status,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            message
        );

        return ResponseEntity.ok(response);
    }
}