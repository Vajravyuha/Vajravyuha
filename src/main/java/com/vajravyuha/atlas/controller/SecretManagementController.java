package com.vajravyuha.atlas.controller;

import com.vajravyuha.atlas.service.SecretManagementService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/applications")
public class SecretManagementController {

    private final SecretManagementService secretManagementService;

    public SecretManagementController(
            SecretManagementService secretManagementService) {
        this.secretManagementService = secretManagementService;
    }

    @PutMapping("/{appName}/secrets")
    public ResponseEntity<Map<String, Object>> storeSecrets(
        @PathVariable String appName,
        @RequestBody Map<String, Map<String, String>> request) {

        if (request == null || !request.containsKey("secrets")) {
            throw new IllegalArgumentException(
                    "Request must contain a secrets object");
        }

        Map<String, String> secrets = request.get("secrets");

        secretManagementService.storeSecrets(appName, secrets);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("appName", appName);
        response.put("status", "SUCCESS");
        response.put("message", "Secrets stored successfully");
        response.put("secretCount", secrets.size());

        return ResponseEntity.ok(response);
    }

    @GetMapping("/{appName}/secrets")
    public ResponseEntity<Map<String, String>> retrieveSecrets(
            @PathVariable String appName) {

        Map<String, String> secrets =
                secretManagementService.retrieveSecrets(appName);

        return ResponseEntity.ok(secrets);
    }
}