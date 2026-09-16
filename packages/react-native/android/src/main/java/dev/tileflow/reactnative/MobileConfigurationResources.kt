package dev.tileflow.reactnative

import android.content.Context
import android.content.res.Resources
import android.util.TypedValue

internal fun mobileConfigurationLiteral(value: TypedValue): String? {
	if (value.type != TypedValue.TYPE_STRING || value.resourceId != 0) return null
	val text = value.string as? String ?: return null
	return if (text.length <= 2080) text else null
}

/** Only this named application array is accepted. There is no manifest or BuildConfig fallback. */
internal fun readMobileConfigurationResources(context: Context): MobileConfiguration {
	try {
		val application = context.applicationContext
		val resources = application.resources
		val id = resources.getIdentifier("tileflow_mobile_configuration", "array", application.packageName)
		if (id == 0 || resources.getResourcePackageName(id) != application.packageName ||
			resources.getResourceTypeName(id) != "array") throw MobileConfigurationException()
		// A complex array is a resource bag, not a scalar/reference. Reject a whole-array alias.
		// Resources.getValue does not return complex bags; obtainTypedArray reads the bag below.
		var scalar = false
		try {
			resources.getValue(id, TypedValue(), false)
			scalar = true
		} catch (_: Resources.NotFoundException) { /* Expected only for a complex bag. */ }
		if (scalar) throw MobileConfigurationException()
		val array = resources.obtainTypedArray(id)
		return MobileConfiguration.load(object : MobileConfigurationValues {
			override val size get() = array.length()
			override val applicationOwned = true
			override fun literalString(index: Int): String? {
				val value = TypedValue()
				return if (array.getValue(index, value)) mobileConfigurationLiteral(value) else null
			}
			override fun close() = array.recycle()
		})
	} catch (_: Exception) {
		// Resource IDs, values, exception messages and configured origins are not diagnostics.
		throw MobileConfigurationException()
	}
}
