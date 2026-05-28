package com.fluxion.client.ui.theme

import androidx.compose.ui.text.font.FontFamily

// The mockups call for Inter (sans) + JetBrains Mono. To avoid bundling font
// binaries into the APK, the DPC client uses the platform sans/monospace
// families and carries the cream palette + sizing instead. Mono is used for
// the brand sub-label, state pills, and the IMEI footer.
val FluxionSans: FontFamily = FontFamily.SansSerif
val FluxionMono: FontFamily = FontFamily.Monospace
