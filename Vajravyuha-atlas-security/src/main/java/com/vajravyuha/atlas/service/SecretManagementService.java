package com.vajravyuha.atlas.service;

import com.vajravyuha.atlas.entity.ApplicationEntity;
import com.vajravyuha.atlas.entity.ApplicationSecretEntity;
import com.vajravyuha.atlas.repository.ApplicationRepository;
import com.vajravyuha.atlas.repository.ApplicationSecretRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class SecretManagementService {

    private final ApplicationRepository applicationRepository;
    private final ApplicationSecretRepository secretRepository;
    private final SecretEncryptionService encryptionService;

    public SecretManagementService(
            ApplicationRepository applicationRepository,
            ApplicationSecretRepository secretRepository,
            SecretEncryptionService encryptionService) {

        this.applicationRepository = applicationRepository;
        this.secretRepository = secretRepository;
        this.encryptionService = encryptionService;
    }

    @Transactional
    public void storeSecrets(
            String appName,
            Map<String, String> secrets) {

        validateAppName(appName);
        validateSecrets(secrets);

        ApplicationEntity application = applicationRepository
                .findByAppName(appName)
                .orElseGet(() -> {
                    ApplicationEntity newApplication =
                            new ApplicationEntity();
                    newApplication.setAppName(appName);
                    return applicationRepository.save(newApplication);
                });

        for (Map.Entry<String, String> entry : secrets.entrySet()) {

            String secretName = entry.getKey();
            String plaintext = entry.getValue();

            SecretEncryptionService.EncryptedSecret encrypted =
                    encryptionService.encrypt(plaintext);

            ApplicationSecretEntity secret = secretRepository
                    .findByApplication_IdAndSecretName(
                            application.getId(),
                            secretName)
                    .orElseGet(ApplicationSecretEntity::new);

            secret.setApplication(application);
            secret.setSecretName(secretName);
            secret.setEncryptedValue(encrypted.encryptedValue());
            secret.setNonce(encrypted.nonce());

            secretRepository.save(secret);
        }
    }

    @Transactional(readOnly = true)
    public Map<String, String> retrieveSecrets(String appName) {

        validateAppName(appName);

        ApplicationEntity application = applicationRepository
                .findByAppName(appName)
                .orElseThrow(() ->
                        new IllegalArgumentException(
                                "Application not found"));

        List<ApplicationSecretEntity> storedSecrets =
                secretRepository.findAllByApplication_Id(
                        application.getId());

        Map<String, String> decryptedSecrets = new LinkedHashMap<>();

        for (ApplicationSecretEntity secret : storedSecrets) {
            String plaintext = encryptionService.decrypt(
                    secret.getEncryptedValue(),
                    secret.getNonce());

            decryptedSecrets.put(secret.getSecretName(), plaintext);
        }

        return decryptedSecrets;
    }

    private void validateAppName(String appName) {
        if (appName == null || appName.isBlank()
                || appName.length() > 100) {
            throw new IllegalArgumentException(
                    "Application name must contain 1–100 characters");
        }
    }

    private void validateSecrets(Map<String, String> secrets) {

        if (secrets == null || secrets.isEmpty()) {
            throw new IllegalArgumentException(
                    "At least one secret is required");
        }

        for (Map.Entry<String, String> entry : secrets.entrySet()) {

            String name = entry.getKey();
            String value = entry.getValue();

            if (name == null || !name.matches(
                    "[A-Za-z_][A-Za-z0-9_]{0,149}")) {
                throw new IllegalArgumentException(
                        "Invalid secret name");
            }

            if (value == null || value.isEmpty()) {
                throw new IllegalArgumentException(
                        "Secret values cannot be null or empty");
            }
        }
    }
}