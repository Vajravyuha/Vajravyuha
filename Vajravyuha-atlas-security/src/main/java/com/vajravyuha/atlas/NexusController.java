package com.vajravyuha.atlas;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NexusController {

    @GetMapping("/nexus")
    public String getNexusInfo() {
        return "Nexus Backend is running successfully!";
    }
}