package com.fluxion.client.ui

import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.fluxion.client.R
import com.fluxion.client.data.SecureStorage
import com.fluxion.client.ui.theme.CreamBg
import com.fluxion.client.ui.theme.CreamPaper
import com.fluxion.client.ui.theme.CreamPaper2
import com.fluxion.client.ui.theme.FluxionMono
import com.fluxion.client.ui.theme.Ink
import com.fluxion.client.ui.theme.InkSoft
import com.fluxion.client.ui.theme.Muted
import com.fluxion.client.ui.theme.Rule
import com.fluxion.client.ui.theme.StateActive
import com.fluxion.client.ui.theme.StateActiveBg
import com.fluxion.client.ui.theme.StateEnrolled
import com.fluxion.client.ui.theme.StateEnrolledBg
import com.fluxion.client.ui.theme.StateLocked
import com.fluxion.client.ui.theme.StateLockedBg
import com.fluxion.client.ui.theme.StateRegistered
import com.fluxion.client.ui.theme.StateRegisteredBg
import com.fluxion.client.ui.theme.StateReleased
import com.fluxion.client.ui.theme.StateReleasedBg

// Reusable cream building blocks shared by every DPC fullscreen surface
// (EULA, Enrolling, Active, Locked, Released). One template, parameterised per
// state — colour + icon + copy vary, structure does not.

data class StateTint(val fg: Color, val bg: Color)

object StateTints {
    val Registered = StateTint(StateRegistered, StateRegisteredBg)
    val Enrolled = StateTint(StateEnrolled, StateEnrolledBg)
    val Active = StateTint(StateActive, StateActiveBg)
    val Locked = StateTint(StateLocked, StateLockedBg)
    val Released = StateTint(StateReleased, StateReleasedBg)
    val Neutral = StateTint(InkSoft, CreamPaper2)
}

@Composable
fun BrandRow() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.logo),
            contentDescription = "Fluxion",
            modifier = Modifier.size(34.dp),
        )
        Column(modifier = Modifier.padding(start = 10.dp)) {
            Text("Fluxion", color = Ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text("DPC", color = Muted, fontFamily = FluxionMono, fontSize = 9.sp, letterSpacing = 1.4.sp)
        }
    }
}

@Composable
fun StatePill(label: String, tint: StateTint) {
    Box(
        modifier = Modifier
            .background(tint.bg, RoundedCornerShape(50))
            .padding(horizontal = 11.dp, vertical = 3.dp),
    ) {
        Text(label.uppercase(), color = tint.fg, fontFamily = FluxionMono, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, letterSpacing = 1.2.sp)
    }
}

// State icon tile. Precedence: operator template icon (remote) → state glyph →
// plain tinted box (never blocks the render).
@Composable
fun HeroBox(tint: StateTint, iconUrl: String? = null, glyph: ImageVector? = null) {
    Box(
        modifier = Modifier
            .size(88.dp)
            .background(tint.bg, RoundedCornerShape(22.dp))
            .border(1.dp, tint.fg.copy(alpha = 0.22f), RoundedCornerShape(22.dp)),
        contentAlignment = Alignment.Center,
    ) {
        when {
            !iconUrl.isNullOrBlank() -> AsyncImage(model = iconUrl, contentDescription = null, modifier = Modifier.size(42.dp))
            glyph != null -> Icon(glyph, contentDescription = null, tint = tint.fg, modifier = Modifier.size(42.dp))
            else -> Box(Modifier.size(38.dp).border(2.dp, tint.fg, RoundedCornerShape(8.dp)))
        }
    }
}

// Spacing between status elements is controlled by StatusScreen (Spacers), so
// these atoms carry no vertical padding of their own.
@Composable
fun DpcTitle(text: String, uppercase: Boolean = false) {
    Text(
        text = if (uppercase) text.uppercase() else text,
        color = Ink,
        fontWeight = FontWeight.Bold,
        fontSize = 21.sp,
        letterSpacing = (-0.2).sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun DpcContent(text: String) {
    Text(
        text = text,
        color = Muted,
        fontSize = 13.5.sp,
        lineHeight = 20.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier.widthIn(max = 244.dp),
    )
}

// Reads the device's own IMEI from secure storage (cached for the composition).
@Composable
fun rememberDeviceImei(): String? {
    val ctx = LocalContext.current
    return remember { runCatching { SecureStorage(ctx).imei }.getOrNull() }
}

// Device identity in a white bordered card: brand · model, plus the full IMEI.
// Tells the holder exactly which device this is. Shared by every status surface
// (active, locked, unlocked, released) so the identity treatment is identical.
@Composable
fun DeviceInfoCard(imei: String? = rememberDeviceImei()) {
    Column(
        modifier = Modifier
            .widthIn(max = 260.dp)
            .background(CreamPaper, RoundedCornerShape(12.dp))
            .border(1.dp, Rule, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 13.dp),
    ) {
        Text("DEVICE", color = Muted, fontFamily = FluxionMono, fontSize = 9.sp, letterSpacing = 1.sp)
        Text(
            "${Build.MANUFACTURER} · ${Build.MODEL}",
            color = Ink, fontWeight = FontWeight.Medium, fontSize = 13.5.sp,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (!imei.isNullOrBlank()) {
            Text("IMEI $imei", color = Muted, fontFamily = FluxionMono, fontSize = 11.5.sp, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
fun ImeiFooter(imei: String?) {
    if (imei.isNullOrBlank()) return
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Rule)
            .background(CreamPaper2)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("IMEI $imei", color = Muted, fontFamily = FluxionMono, fontSize = 10.sp)
    }
}

// Standard centered fullscreen surface: cream background, brand row at top,
// centered hero/title/content stack, optional bottom action + IMEI footer.
@Composable
fun DpcSurface(
    imei: String? = null,
    top: (@Composable () -> Unit)? = null,
    bottom: (@Composable () -> Unit)? = null,
    center: @Composable ColumnScope.() -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = CreamBg) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxWidth().background(CreamPaper).padding(16.dp)) { BrandRow() }
            // Content sits a little above centre (top:bottom space ≈ 1:1.7).
            Column(
                modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = 20.dp, vertical = 22.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.weight(1f))
                top?.invoke()
                center()
                Spacer(Modifier.weight(1.7f))
            }
            bottom?.invoke()
            ImeiFooter(imei)
        }
    }
}

// One parameterised status surface for every device state (active, locked,
// unlocked, released, …). Layout order + spacing mirror the design mockup
// exactly: icon tile → state pill → title → body → device identity card.
@Composable
fun StatusScreen(
    tint: StateTint,
    stateLabel: String,
    title: String,
    content: String,
    glyph: ImageVector? = null,
    iconUrl: String? = null,
) {
    DpcSurface {
        HeroBox(tint, iconUrl, glyph)
        Spacer(Modifier.height(16.dp))
        StatePill(stateLabel, tint)
        Spacer(Modifier.height(14.dp))
        DpcTitle(title)
        Spacer(Modifier.height(10.dp))
        DpcContent(content)
        Spacer(Modifier.height(22.dp))
        DeviceInfoCard()
    }
}
