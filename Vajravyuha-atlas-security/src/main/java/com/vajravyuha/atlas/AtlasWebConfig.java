package com.vajravyuha.atlas;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class AtlasWebConfig implements WebMvcConfigurer {

    private final AtlasAuthInterceptor authInterceptor;

    public AtlasWebConfig(AtlasAuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(authInterceptor)
            .addPathPatterns(
                    "/api/v1/scans",
                    "/api/v1/applications/**"
            );
}
}