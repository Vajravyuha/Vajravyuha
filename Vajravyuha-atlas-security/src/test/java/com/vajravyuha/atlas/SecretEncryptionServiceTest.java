package com.vajravyuha.atlas;

import com.vajravyuha.atlas.service.SecretEncryptionService;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

class SecretEncryptionServiceTest {

    private SecretEncryptionService createService() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);

        return new SecretEncryptionService(
                Base64.getEncoder().encodeToString(key)
        );
    }

    @Test
    void encryptAndDecryptShouldReturnOriginalSecret() {
        SecretEncryptionService service = createService();

        String original = "my-database-password";

        SecretEncryptionService.EncryptedSecret encrypted =
                service.encrypt(original);

        assertNotEquals(original, encrypted.encryptedValue());
        assertEquals(
                original,
                service.decrypt(
                        encrypted.encryptedValue(),
                        encrypted.nonce()
                )
        );
    }

    @Test
    void encryptingTwiceShouldProduceDifferentCiphertexts() {
        SecretEncryptionService service = createService();

        var first = service.encrypt("same-secret");
        var second = service.encrypt("same-secret");

        assertNotEquals(first.nonce(), second.nonce());
        assertNotEquals(
                first.encryptedValue(),
                second.encryptedValue()
        );
    }

    @Test
    void tamperedCiphertextShouldBeRejected() {
        SecretEncryptionService service = createService();

        var encrypted = service.encrypt("sensitive-value");

        byte[] ciphertext =
                Base64.getDecoder().decode(encrypted.encryptedValue());

        ciphertext[0] ^= 1;

        String tampered = Base64.getEncoder()
                .encodeToString(ciphertext);

        assertThrows(
                IllegalStateException.class,
                () -> service.decrypt(tampered, encrypted.nonce())
        );
    }
}