package com.vajravyuha.atlas;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
public class AtlasScanService implements ScanService {

    private static final Logger logger =
            LoggerFactory.getLogger(AtlasScanService.class);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${atlas.scan.default-environment}")
    private String defaultEnvironment;

    @Value("${atlas.scan.trivy-path}")
    private String trivyPath;

    @Override
    public ScanResult scanApplication(String appName, String environment) {
        throw new ScanException(
                "Image name is required. Use the image-based scan operation."
        );
    }

    public ScanResult scanImage(String deployId,String appName,String environment,String image) 
        {logger.info("Starting Trivy image scan for application: {}", appName);

        if (environment == null || environment.isBlank()) {
            environment = defaultEnvironment;
        }

        if (image == null || image.isBlank()) {
            throw new ScanException(
            "INVALID_REQUEST",
            "Container image is required",
            deployId
        );
    }

        ProcessBuilder processBuilder = new ProcessBuilder(
                trivyPath,
                "image",
                "--scanners", "vuln",
                "--format", "json",
                "--timeout", "2m",
                image
        );

        processBuilder.redirectErrorStream(false);

        Process process = null;

        try {
            process = processBuilder.start();

            // Read stdout and stderr concurrently to avoid filling a pipe.
            final Process runningProcess = process;

            var executor = java.util.concurrent.Executors.newFixedThreadPool(2);

            try {
                var stdoutFuture = executor.submit(() ->
                        new String(
                                runningProcess.getInputStream().readAllBytes(),
                                StandardCharsets.UTF_8
                        )
                );

                var stderrFuture = executor.submit(() ->
                        new String(
                                runningProcess.getErrorStream().readAllBytes(),
                                StandardCharsets.UTF_8
                        )
                );

                boolean completed = process.waitFor(130, TimeUnit.SECONDS);

                if (!completed) {
                    process.destroyForcibly();
                    process.waitFor();
                    throw new ScanException("SCAN_TIMEOUT","Trivy scan timed out",deployId);
                }

                String output = stdoutFuture.get(10, TimeUnit.SECONDS);
                String errorOutput = stderrFuture.get(10, TimeUnit.SECONDS);

                if (process.exitValue() != 0) {
                    logger.error("Trivy image scan failed. Exit code: {}. Details: {}",process.exitValue(),errorOutput);
                    String lowerError = errorOutput.toLowerCase();

                    if (lowerError.contains("manifest unknown") || lowerError.contains("name unknown") || lowerError.contains("no such image") || lowerError.contains("image not found")) {
                        throw new ScanException("IMAGE_NOT_FOUND","Could not retrieve the requested container image",deployId);
                    }

                    if (lowerError.contains("unsupported image") || lowerError.contains("unable to determine image") || lowerError.contains("no supported os") || lowerError.contains("unrecognized image")) {
                        throw new ScanException("IMAGE_UNSCANNABLE","The requested container image could not be scanned",deployId);
                    }

                    throw new ScanException("INTERNAL_ERROR","Trivy failed to complete the vulnerability scan",deployId);
            }

                JsonNode report;

                try {
                    report = objectMapper.readTree(output);

                    if (report == null || !report.path("Results").isArray()) {
                        throw new ScanException("INTERNAL_ERROR","Trivy returned an invalid scan report",deployId);
                    }
                } 
                catch (IOException e) {
                    throw new ScanException("INTERNAL_ERROR","Unable to parse the Trivy scan report",deployId);
                }

                int criticalCount = countVulnerabilities(report, "CRITICAL");
                int highCount = countVulnerabilities(report, "HIGH");
                int mediumCount = countVulnerabilities(report, "MEDIUM");
                int lowCount = countVulnerabilities(report, "LOW");

                logger.info(
                        "Image scan results for {}: CRITICAL={}, HIGH={}, MEDIUM={}, LOW={}",
                        image, criticalCount, highCount, mediumCount, lowCount
                );

                return new ScanResult(
                        criticalCount,
                        highCount,
                        mediumCount,
                        lowCount
                );

            } finally {
                executor.shutdownNow();
            }

        } catch (IOException e) {
            logger.error("Unable to start Trivy image scanner", e);
            throw new ScanException("Unable to start Trivy image scanner");

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();

            if (process != null) {
                process.destroyForcibly();
            }

            logger.error("Trivy image scan was interrupted", e);
            throw new ScanException("Trivy scan was interrupted");

        } catch (java.util.concurrent.ExecutionException
                 | java.util.concurrent.TimeoutException e) {

            if (process != null) {
                process.destroyForcibly();
            }

            logger.error("Failed to read Trivy output", e);
            throw new ScanException("Failed to read Trivy scan output");
        }
    }

    private int countVulnerabilities(JsonNode report, String severity) {

        int count = 0;

        JsonNode results = report.path("Results");

        for (JsonNode result : results) {
            JsonNode vulnerabilities = result.path("Vulnerabilities");

            for (JsonNode vulnerability : vulnerabilities) {
                if (severity.equalsIgnoreCase(
                        vulnerability.path("Severity").asText())) {
                    count++;
                }
            }
        }

        return count;
    }
}