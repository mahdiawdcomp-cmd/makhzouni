package com.inventory.ui.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SplashDestinationTest {

    @Test
    fun noSerialAlwaysGoesToSerialActivation() {
        // Regardless of androidEnabled / session.
        for (enabled in listOf<Boolean?>(true, false, null)) {
            for (session in listOf(true, false)) {
                assertTrue(
                    decideSplashDestination(hasSerial = false, androidEnabled = enabled, hasSession = session)
                            is SplashDestination.SerialActivation
                )
            }
        }
    }

    @Test
    fun serialWithAndroidExplicitlyDisabledAlwaysBlocks() {
        for (session in listOf(true, false)) {
            assertTrue(
                decideSplashDestination(hasSerial = true, androidEnabled = false, hasSession = session)
                        is SplashDestination.AndroidDisabled
            )
        }
    }

    @Test
    fun serialEnabledOrUnknownWithSessionGoesToDashboard() {
        assertEquals(
            SplashDestination.Dashboard,
            decideSplashDestination(hasSerial = true, androidEnabled = true, hasSession = true)
        )
        // null (unknown) is fail-open = treated as enabled.
        assertEquals(
            SplashDestination.Dashboard,
            decideSplashDestination(hasSerial = true, androidEnabled = null, hasSession = true)
        )
    }

    @Test
    fun serialEnabledOrUnknownWithoutSessionGoesToLogin() {
        assertEquals(
            SplashDestination.Login,
            decideSplashDestination(hasSerial = true, androidEnabled = true, hasSession = false)
        )
        assertEquals(
            SplashDestination.Login,
            decideSplashDestination(hasSerial = true, androidEnabled = null, hasSession = false)
        )
    }
}
