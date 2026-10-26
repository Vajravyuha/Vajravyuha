package com.vajravyuha.atlas;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello! Spring Boot is working.";
    }
    @GetMapping("/welcome")
        public String welcome(@RequestParam String name){
            return "welcome to sprng boot,"+name+"!";
        }
    }
