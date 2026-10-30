package com.vajravyuha.atlas.repository;

import com.vajravyuha.atlas.entity.ApplicationSecretEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApplicationSecretRepository
        extends JpaRepository<ApplicationSecretEntity, Long> {

    List<ApplicationSecretEntity> findAllByApplication_Id(Long applicationId);

    Optional<ApplicationSecretEntity> findByApplication_IdAndSecretName(
            Long applicationId,
            String secretName
    );
}