package com.fluxion.client.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.runtime.Composable

// Operator template copy carried into the Active surfaces. Icons arrive in
// Phase 6; for now title/content only.
data class WelcomeTemplate(
    val title: String? = null,
    val content: String? = null,
    val headerIconUrl: String? = null,
)

// 2A · Active welcome — shown transiently right after ACTIVATE, then auto-
// settles to the steady ActiveScreen.
@Composable
fun ActiveWelcomeScreen(template: WelcomeTemplate?) {
    StatusScreen(
        tint = StateTints.Active,
        stateLabel = "Active",
        glyph = Icons.Outlined.VerifiedUser,
        iconUrl = template?.headerIconUrl,
        title = template?.title ?: "Welcome to Device Financing",
        content = template?.content
            ?: "Your device is now active under the Device Financing program.",
    )
}

// Steady Active state — survives app kill via persisted phase=ACTIVE.
@Composable
fun ActiveScreen(template: WelcomeTemplate?) {
    StatusScreen(
        tint = StateTints.Active,
        stateLabel = "Active",
        glyph = Icons.Outlined.VerifiedUser,
        iconUrl = template?.headerIconUrl,
        title = template?.title ?: "Device active",
        content = template?.content
            ?: "Your device is active and checking in. Operator commands apply automatically.",
    )
}

// 2C · Welcome back — shown transiently after UNLOCK, then auto-settles to
// the steady ActiveScreen.
@Composable
fun WelcomeBackScreen(template: WelcomeTemplate?) {
    StatusScreen(
        tint = StateTints.Active,
        stateLabel = "Active",
        glyph = Icons.Outlined.LockOpen,
        iconUrl = template?.headerIconUrl,
        title = template?.title ?: "Device unlocked — welcome back",
        content = template?.content ?: "All features are available again.",
    )
}
