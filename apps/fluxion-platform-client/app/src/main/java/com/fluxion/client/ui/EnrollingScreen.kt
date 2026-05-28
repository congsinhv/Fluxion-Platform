package com.fluxion.client.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fluxion.client.ui.theme.StateRegistered

// 1B · Enrolling. Shown right after EULA accept; persists through enroll +
// checkin polling until an ACTIVATE command arrives (Phase 5 swaps it for the
// Active welcome). Same icon→pill→title→body rhythm as the other status
// surfaces, with a progress spinner instead of a device-identity line.
@Composable
fun EnrollingScreen(imei: String? = null) {
    DpcSurface(
        imei = imei,
        center = {
            HeroBox(StateTints.Registered, glyph = Icons.Outlined.Sync)
            Spacer(Modifier.height(16.dp))
            StatePill("Enrolling", StateTints.Enrolled)
            Spacer(Modifier.height(14.dp))
            DpcTitle("Setting up your device")
            Spacer(Modifier.height(10.dp))
            DpcContent("Enrolling with the Fluxion platform. This screen will close automatically once your device is activated.")
            Spacer(Modifier.height(22.dp))
            CircularProgressIndicator(modifier = Modifier.size(28.dp), color = StateRegistered, strokeWidth = 3.dp)
        },
    )
}
