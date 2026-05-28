package com.fluxion.client.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fluxion.client.ui.theme.Accent
import com.fluxion.client.ui.theme.CreamBg
import com.fluxion.client.ui.theme.CreamPaper
import com.fluxion.client.ui.theme.Ink
import com.fluxion.client.ui.theme.InkSoft
import com.fluxion.client.ui.theme.Muted
import com.fluxion.client.ui.theme.StateLocked

// 1A · EULA. Content anchored to the top (no large empty header gap); the
// policy is shown as three scannable capability bullets; CTA pinned at bottom.
@Composable
fun EulaScreen(
    errorText: String? = null,
    onAccept: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = CreamBg) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxWidth().background(CreamPaper).padding(16.dp)) { BrandRow() }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 24.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(54.dp)
                        .background(Accent.copy(alpha = 0.10f), RoundedCornerShape(15.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Description, contentDescription = null, tint = Accent, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.size(16.dp))
                Text("Enroll this device", color = Ink, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Spacer(Modifier.size(8.dp))
                Text(
                    "By accepting, this device joins the Fluxion Device Financing program. The operator may:",
                    color = Muted, fontSize = 13.sp,
                )
                Spacer(Modifier.size(18.dp))

                EulaBullet(Icons.Outlined.Lock, "Lock the device remotely if contract terms aren't met")
                Spacer(Modifier.size(12.dp))
                EulaBullet(Icons.Outlined.Notifications, "Send notifications and payment reminders")
                Spacer(Modifier.size(12.dp))
                EulaBullet(Icons.Outlined.Inventory2, "Release the device once the contract ends")

                errorText?.let {
                    Spacer(Modifier.size(16.dp))
                    Text("Error: $it", color = StateLocked, fontSize = 13.sp)
                }
            }

            Column(modifier = Modifier.fillMaxWidth().background(CreamPaper).padding(20.dp)) {
                Button(
                    onClick = onAccept,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = CreamPaper),
                ) {
                    Text("Accept and enroll", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun EulaBullet(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(26.dp)
                .background(Accent.copy(alpha = 0.10f), RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(14.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, color = InkSoft, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
    }
}
