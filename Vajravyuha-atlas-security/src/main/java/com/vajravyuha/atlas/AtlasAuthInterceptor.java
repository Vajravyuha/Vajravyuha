package com.vajravyuha.atlas;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
public class AtlasAuthInterceptor implements HandlerInterceptor {

    @Value("${atlas.security.service-token}")
    private String serviceToken;

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler) throws IOException {

        String authorization = request.getHeader("Authorization");

        if (serviceToken == null
                || serviceToken.isBlank()
                || serviceToken.equals("${ATLAS_SERVICE_TOKEN}")) {

            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":\"INTERNAL_ERROR\","
                    + "\"message\":\"Atlas service token is not configured\","
                    + "\"deployId\":null}"
            );
            return false;
        }

        if (authorization == null
                || !authorization.startsWith("Bearer ")) {

            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":\"UNAUTHORIZED\","
                    + "\"message\":\"Missing or invalid Bearer token\","
                    + "\"deployId\":null}"
            );
            return false;
        }

        String providedToken = authorization.substring(7);

        boolean valid = MessageDigest.isEqual(
                serviceToken.getBytes(StandardCharsets.UTF_8),
                providedToken.getBytes(StandardCharsets.UTF_8)
        );

        if (!valid) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":\"UNAUTHORIZED\","
                    + "\"message\":\"Invalid service token\","
                    + "\"deployId\":null}"
            );
            return false;
        }

        return true;
    }
}