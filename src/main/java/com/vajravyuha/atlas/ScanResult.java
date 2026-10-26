package com.vajravyuha.atlas;

public class ScanResult {

    private final int criticalCount;
    private final int highCount;
    private final int mediumCount;
    private final int lowCount;

    public ScanResult(
            int criticalCount,
            int highCount,
            int mediumCount,
            int lowCount) {

        this.criticalCount = criticalCount;
        this.highCount = highCount;
        this.mediumCount = mediumCount;
        this.lowCount = lowCount;
    }

    public int getCriticalCount() {
        return criticalCount;
    }

    public int getHighCount() {
        return highCount;
    }

    public int getMediumCount() {
        return mediumCount;
    }

    public int getLowCount() {
        return lowCount;
    }
}