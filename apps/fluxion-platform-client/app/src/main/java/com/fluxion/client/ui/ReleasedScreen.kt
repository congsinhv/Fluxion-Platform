package com.fluxion.client.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.runtime.Composable

// 3A · Released (terminal).
@Composable
fun ReleasedScreen() {
    StatusScreen(
        tint = StateTints.Released,
        stateLabel = "Released",
        glyph = Icons.Outlined.Inventory2,
        title = "Device released",
        content = "This device has been released from the Fluxion program. " +
            "You may uninstall this app or leave it dormant.",
    )
}
