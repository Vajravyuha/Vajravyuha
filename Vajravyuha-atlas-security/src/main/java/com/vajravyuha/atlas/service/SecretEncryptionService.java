package com.vajravyuha.atlas.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

@Service
public class SecretEncryptionService {

    private static final String ALGORITHM = "AES";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int KEY_LENGTH_BYTES = 32;
    private static final int NONCE_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private final SecretKeySpec secretKey;
    private final SecureRandom secureRandom = new SecureRandom();

    public SecretEncryptionService(
            @Value("${atlas.security.encryption-key}") String encodedKey) {

        byte[] keyBytes;

        try {
            keyBytes = Base64.getDecoder().decode(encodedKey);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "Atlas encryption key must be valid Base64", exception);
        }

        if (keyBytes.length != KEY_LENGTH_BYTES) {
            throw new IllegalArgumentException(
                    "Atlas encryption key must decode to exactly 32 bytes");
        }

        this.secretKey = new SecretKeySpec(keyBytes, ALGORITHM);
    }

    public EncryptedSecret encrypt(String plaintext) {
        if (plaintext == null) {
            throw new IllegalArgumentException("Secret value cannot be null");
        }

        try {
            byte[] nonce = new byte[NONCE_LENGTH_BYTES];
            secureRandom.nextBytes(nonce);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    secretKey,
                    new GCMParameterSpec(TAG_LENGTH_BITS, nonce)
            );

            byte[] ciphertext = cipher.doFinal(
                    plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8)
            );

            return new EncryptedSecret(
                    Base64.getEncoder().encodeToString(ciphertext),
                    Base64.getEncoder().encodeToString(nonce)
            );

        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Atlas could not encrypt the secret", exception);
        }
    }

    public String decrypt(String encryptedValue, String encodedNonce) {
        try {
            byte[] ciphertext = Base64.getDecoder().decode(encryptedValue);
            byte[] nonce = Base64.getDecoder().decode(encodedNonce);

            if (nonce.length != NONCE_LENGTH_BYTES) {
                throw new IllegalArgumentException("Invalid encryption nonce");
            }

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    secretKey,
                    new GCMParameterSpec(TAG_LENGTH_BITS, nonce)
            );

            byte[] plaintext = cipher.doFinal(ciphertext);

            return new String(
                    plaintext,
                    java.nio.charset.StandardCharsets.UTF_8
            );

        } catch (Exception exception) {
            throw new IllegalStateException(
                    "Atlas could not decrypt the secret", exception);
        }
    }

    public record EncryptedSecret(String encryptedValue, String nonce) {
    }
}