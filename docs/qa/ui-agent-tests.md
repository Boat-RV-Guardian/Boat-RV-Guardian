# UI Browser-Agent Test Plan

This document outlines the standard UI test plan designed to be executed manually by a human or automatically via an **AI Browser Subagent**. 

When an AI agent is requested to "Perform a UI test", it should follow these steps visually using the `demo.boatrvguardian.com` environment.

## Execution Environment
**Target URL:** `https://demo.boatrvguardian.com`
**Mock Data:** The demo environment uses fake, deterministic data. No real Firebase account or LinkTap hardware is harmed during this test.

---

## Test Suite

### 1. The Vehicle Switcher (Navigation Test)
*   **Action:** 
    1. Look for the main vehicle navigation header.
    2. Click the dropdown/switcher to view the list of vehicles.
    3. Select a different vehicle from the list.
*   **Verification (DOM Check):** The main dashboard should instantly update its data (e.g., sensor lists, vehicle name) to reflect the newly selected vehicle without reloading the entire page.

### 2. Valve UI State (Control Test)
*   **Action:**
    1. Navigate to the LinkTap / Valve control section.
    2. Locate the "Close Valve" button.
    3. Click "Close Valve".
*   **Verification (DOM Check):** The button or valve status indicator should immediately change state (e.g., to "Pending", "Closing", or a spinner) indicating that the UI responded to the optimistic update before network confirmation.

### 3. Telemetry Display (Component Rendering Test)
*   **Action:**
    1. Navigate to the **Systems** or **Environment** sub-page.
    2. Locate the card or widget displaying the Shelly H&T (Temperature & Humidity) sensor.
*   **Verification (DOM Check):** Verify that the component renders **both** the temperature value (e.g., `72°F`) and the humidity value (e.g., `45% RH`) side-by-side or stacked. It should not render just one.

### 4. Role Enforcement Visibility (Security UI Test)
*   **Action:**
    1. Navigate to the Friends / Members tab.
    2. Observe the current user's role badge (if present in demo data).
    3. If acting as a `monitor` role, navigate to a control screen (like Valve control).
*   **Verification (DOM Check):** Ensure a "Monitor Only" (or similar warning) banner is visible on the screen, indicating that controls are correctly disabled visually.

---

> **For AI Agents:** After executing these steps in a headless browser, generate a report detailing which tests passed or failed, and automatically capture the session video artifact for the user to review.
