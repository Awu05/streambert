package com.awu05.streambert.update

data class Version(val major: Int, val minor: Int, val patch: Int) : Comparable<Version> {
    override fun compareTo(other: Version): Int =
        compareValuesBy(this, other, Version::major, Version::minor, Version::patch)

    override fun toString() = "$major.$minor.$patch"

    companion object {
        private val pattern = Regex("""[vV]?(\d+)\.(\d+)(?:\.(\d+))?""")

        fun parse(value: String): Version? {
            val (major, minor, patch) = pattern.matchEntire(value)?.destructured ?: return null
            return Version(
                major.toIntOrNull() ?: return null,
                minor.toIntOrNull() ?: return null,
                (patch.ifEmpty { "0" }).toIntOrNull() ?: return null,
            )
        }
    }
}
