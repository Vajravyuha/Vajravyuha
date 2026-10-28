package com.vajravyuha.atlas.repository;

import com.vajravyuha.atlas.entity.ApplicationEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ApplicationRepository
        extends JpaRepository<ApplicationEntity, Long> {

    Optional<ApplicationEntity> findByAppName(String appName);
}