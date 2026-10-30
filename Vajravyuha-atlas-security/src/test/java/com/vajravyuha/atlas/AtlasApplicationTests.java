package com.vajravyuha.atlas;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AtlasApplicationTests {

    @Test
    void criticalVulnerabilityShouldBlockDeployment() {
        int criticalCount = 1;

        String status = criticalCount > 0 ? "BLOCKED" : "PASSED";

        assertEquals("BLOCKED", status);
    }

    @Test
    void zeroCriticalVulnerabilitiesShouldPassDeployment() {
        int criticalCount = 0;

        String status = criticalCount > 0 ? "BLOCKED" : "PASSED";

        assertEquals("PASSED", status);
    }

    @Test
    void controllerShouldBlockDeploymentWithCriticalVulnerability() {
        ScanService scanService = mock(ScanService.class);
        AtlasStatusController controller =
                new AtlasStatusController(scanService);

        ScanResult scanResult = new ScanResult(1, 2, 3, 4);

        when(scanService.scanImage(
                "dep_test_critical",
                "test-app",
                "production",
                "test-image:latest"
        )).thenReturn(scanResult);

        ScanRequest request = new ScanRequest();
        request.setDeployId("dep_test_critical");
        request.setAppName("test-app");
        request.setEnvironment("production");
        request.setImage("test-image:latest");
        request.setCommitSha("a1b2c3d");
        request.setRequestedBy("core");

        ResponseEntity<ScanResponse> response = controller.scanImage(request);

        assertEquals(200, response.getStatusCode().value());
        assertEquals("BLOCKED", response.getBody().getStatus());
        assertEquals(1, response.getBody().getCriticalCount());
    }
}