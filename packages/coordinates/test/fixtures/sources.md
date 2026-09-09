# Coordinate control-point sources

These are forward reference values. They are not tests of a particular engine and do not establish general support for a CRS pair or a grid.

## Upstream PROJ regression vectors

The first three values come from immutable upstream PROJ GIE files at commit [`b834d1f401067d2fa1ce8ad2762c29563cac9000`](https://github.com/OSGeo/PROJ/tree/b834d1f401067d2fa1ce8ad2762c29563cac9000):

- [`epsg_no_grid.gie`](https://raw.githubusercontent.com/OSGeo/PROJ/b834d1f401067d2fa1ce8ad2762c29563cac9000/test/gie/epsg_no_grid.gie), SHA-256 `acec30144b59cdda117572957deb9b3118b764edf429570c305af2e94bc0571b`.
- [`epsg_grid.gie`](https://raw.githubusercontent.com/OSGeo/PROJ/b834d1f401067d2fa1ce8ad2762c29563cac9000/test/gie/epsg_grid.gie), SHA-256 `0707877498de20af5861055518d2e565cf5b26bd186e04a7b3e345cb234303f6`.
- [PROJ COPYING](https://raw.githubusercontent.com/OSGeo/PROJ/b834d1f401067d2fa1ce8ad2762c29563cac9000/COPYING), MIT-style license.

The GIE source uses official CRS axis order. This fixture stores positions as `x, y[, z]`: geographic latitude, longitude inputs are therefore reordered to longitude, latitude. The `0.0001` metre tolerance is the upstream regression tolerance; it is not an agency survey-accuracy claim.

The sourceGridNames entries identify the source representation, including the OS text grid; they are not filenames required by a Tileflow runtime distribution. The named grids are references only. No grid is included here. Their source and per-file license records are in [PROJ-data at commit 7325f2a5c3aea9ce38a13f134a46bd1c56409894](https://github.com/OSGeo/PROJ-data/tree/7325f2a5c3aea9ce38a13f134a46bd1c56409894) and its [license inventory](https://raw.githubusercontent.com/OSGeo/PROJ-data/7325f2a5c3aea9ce38a13f134a46bd1c56409894/copyright_and_licenses.csv), SHA-256 `1222fbfae2ad0033876e744d29ee40287ae6fd1f48a943fdde3c2a556b1d2379`.

## Ordnance Survey full OSTN15/OSGM15 vector

`TP02` is copied from the [full OSTN15/OSGM15 Developer Pack](https://www.ordnancesurvey.co.uk/documents/resources/OSTN15-OSGM15-DevelopersPack.zip). The unversioned download is pinned by ZIP SHA-256 `67069a6d6efe74f637249366f400f3192c03853c78d5a9c3eac2c78ede88364d`; the pack test input and output entries have SHA-256 `83e40aa7c4bf4907aca47d75e068714142834f1ac145c24875b97464ffe8bc96` and `8ad7938eb400c6f5172f65236efdef9af1617045cb95fe50afaa4c6ebf2da1bd`.

It is an agency-published full-model comparison vector. Its published output is millimetre-resolved; `0.002` metre is an engineering conformance threshold, not a published accuracy or survey tolerance. The Developer Pack and grid are not redistributed here; their data redistribution license is not asserted by this fixture.
