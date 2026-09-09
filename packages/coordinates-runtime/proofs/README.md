# Analytical applicability proofs

A proof is an explicit part of an execution release, identified by its document SHA-256. The
runtime verifies its bytes and supported version before passing it to native execution. No proof
means no exception to the requirement for a catalog operation area. A proof does not supply an
area of use or an accuracy estimate.

## EPSG:9602, version 1

This proof covers only a direct geographic/geocentric conversion between compatible static 3D CRS
with equivalent datum or ensemble, ellipsoid and prime meridian. It excludes grids, ballpark and
time dependence. Projection, datum transformation, identity and concatenated operations cannot
borrow this proof merely because their pipelines contain a Cartesian conversion.

For an oblate ellipsoid or sphere, let `a` and `b` be the semi-axes and `N` the prime-vertical radius
of curvature. The admitted normal branch requires `N*(1-e²)+h > 0`, latitude strictly between the
poles, and nonzero Cartesian horizontal radius. Thus longitude is defined and latitude has the sign
of Z. The equatorial interior with multiple geodetic normal solutions is excluded.

For `p=hypot(X,Y)>0`, the inverse latitude solves
`Z=p*tan(phi)-e²*a*sin(phi)/sqrt(1-e²*sin²(phi))`. On either hemisphere its derivative changes sign
at most once, from negative to positive: its stationary condition is
`p=e²*a*(cos²(phi)/(1-e²*sin²(phi)))^(3/2)`, whose right side decreases towards the pole. For nonzero
Z there is one root on the same hemisphere; on the equator the admitted branch requires `p>a*e²`.
This defines the branch algebraically, without choosing a location from an ambiguous inverse.

For every point the runtime additionally compares PROJ with the independent forward equations in
the proof document and executes the inverse operation. Geographic closure must satisfy the angular
tolerance and height tolerance; Cartesian closure must satisfy the linear tolerance in every axis.
Longitude closure is compared modulo 360 degrees. Non-finite values, undefined longitude, other
normal branches, or residuals outside the stated tolerances fail explicitly. An inverse that returns
finite numbers is insufficient evidence.

Both CRS areas still apply. `areasOfUse:null` and `accuracy:null` remain unchanged. Operation
metadata identifies the analytical proof and release; each successful position records proof
verification separately from the absent operation area. Tolerances describe computational checks,
not geodetic accuracy or a public accuracy guarantee.
