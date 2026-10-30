package com.vajravyuha.atlas;

import com.vajravyuha.atlas.entity.ApplicationEntity;
import com.vajravyuha.atlas.entity.ApplicationSecretEntity;
import com.vajravyuha.atlas.repository.ApplicationRepository;
import com.vajravyuha.atlas.repository.ApplicationSecretRepository;
import com.vajravyuha.atlas.service.SecretEncryptionService;
import com.vajravyuha.atlas.service.SecretManagementService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class SecretManagementServiceTest {

    private ApplicationRepository applicationRepository;
    private ApplicationSecretRepository secretRepository;
    private SecretEncryptionService encryptionService;
    private SecretManagementService managementService;

    @BeforeEach
    void setUp() {
        applicationRepository = mock(ApplicationRepository.class);
        secretRepository = mock(ApplicationSecretRepository.class);

        byte[] key = new byte[32];
        java.security.SecureRandom random =
                new java.security.SecureRandom();
        random.nextBytes(key);

        encryptionService = new SecretEncryptionService(
                java.util.Base64.getEncoder().encodeToString(key)
        );

        managementService = new SecretManagementService(
                applicationRepository,
                secretRepository,
                encryptionService
        );
    }

    @Test
    void shouldEncryptSecretBeforeSaving() {
        ApplicationEntity application = new ApplicationEntity();
        application.setAppName("payment-gateway");

        // Simulate a saved application with ID 1.
        when(applicationRepository.findByAppName("payment-gateway"))
                .thenReturn(Optional.of(application));

        // The entity needs an ID for the repository lookup.
        // This test checks the encryption/storage interaction.
        when(secretRepository.findByApplication_IdAndSecretName(
                any(), any()))
                .thenReturn(Optional.empty());

        when(secretRepository.save(any(ApplicationSecretEntity.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Map<String, String> secrets = Map.of(
                "DATABASE_PASSWORD", "test-password-123"
        );

        managementService.storeSecrets("payment-gateway", secrets);

        verify(secretRepository).save(argThat(secret ->
                secret.getEncryptedValue() != null
                && !secret.getEncryptedValue().equals("test-password-123")
                && secret.getNonce() != null
                && !secret.getNonce().isBlank()
        ));
    }

    @Test
    void shouldRejectEmptySecrets() {
        assertThrows(
                IllegalArgumentException.class,
                () -> managementService.storeSecrets(
                        "payment-gateway", Map.of())
        );

        verifyNoInteractions(applicationRepository, secretRepository);
    }

    @Test
    void shouldRejectInvalidSecretName() {
        Map<String, String> secrets = Map.of(
                "INVALID NAME!", "test-value"
        );

        assertThrows(
                IllegalArgumentException.class,
                () -> managementService.storeSecrets(
                        "payment-gateway", secrets)
        );

        verifyNoInteractions(applicationRepository, secretRepository);
    }

    @Test
    void shouldDecryptSecretsWhenRetrieving() {
        ApplicationEntity application = new ApplicationEntity();
        application.setAppName("payment-gateway");

        when(applicationRepository.findByAppName("payment-gateway"))
                .thenReturn(Optional.of(application));

        var encrypted = encryptionService.encrypt("test-password-123");

        ApplicationSecretEntity storedSecret =
                new ApplicationSecretEntity();
        storedSecret.setApplication(application);
        storedSecret.setSecretName("DATABASE_PASSWORD");
        storedSecret.setEncryptedValue(encrypted.encryptedValue());
        storedSecret.setNonce(encrypted.nonce());

        when(secretRepository.findAllByApplication_Id(any()))
                .thenReturn(List.of(storedSecret));

        Map<String, String> result =
                managementService.retrieveSecrets("payment-gateway");

        assertEquals("test-password-123",
                result.get("DATABASE_PASSWORD"));
    }
}