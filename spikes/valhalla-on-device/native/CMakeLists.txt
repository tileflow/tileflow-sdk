# The on-device router: tf_valhalla over a prebuilt libvalhalla.a (scripts/build-valhalla.sh).
#   TF_TARGET=ios-sim  -> static libtf_valhalla.a for the iOS app to link
#   TF_TARGET=android  -> shared libtf_valhalla.so with its JNI entry points
cmake_minimum_required(VERSION 3.22)
project(tf_valhalla CXX C)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(SPIKE_BUILD "${CMAKE_CURRENT_LIST_DIR}/../.build")
set(VALHALLA_SRC "${SPIKE_BUILD}/valhalla")
set(VALHALLA_OUT "${SPIKE_BUILD}/valhalla-${TF_TARGET}/build")
set(PROTOBUF_OUT "${SPIKE_BUILD}/protobuf-${TF_TARGET}/install")

add_library(valhalla_prebuilt STATIC IMPORTED)
set_target_properties(valhalla_prebuilt PROPERTIES IMPORTED_LOCATION "${VALHALLA_OUT}/src/libvalhalla.a")
add_library(protobuf_lite STATIC IMPORTED)
set_target_properties(protobuf_lite PROPERTIES IMPORTED_LOCATION "${PROTOBUF_OUT}/lib/libprotobuf-lite.a")

set(sources tf_valhalla.cc)
if(TF_TARGET STREQUAL "android")
  list(APPEND sources tf_valhalla_jni.cc)
  add_library(tf_valhalla SHARED ${sources})
  find_library(log-lib log)
  target_link_libraries(tf_valhalla PRIVATE valhalla_prebuilt protobuf_lite z ${log-lib})
  # Export only the JNI entry points so the linker can drop everything they do not reach.
  target_link_options(tf_valhalla PRIVATE -Wl,--gc-sections -Wl,--exclude-libs,ALL -Wl,--icf=all
    -Wl,-Map=${CMAKE_BINARY_DIR}/tf_valhalla.map)
else()
  add_library(tf_valhalla STATIC ${sources})
endif()

target_compile_definitions(tf_valhalla PRIVATE HAS_REMOTE_API=0 AUTO_DOWNLOAD=0
  BOOST_ALLOW_DEPRECATED_HEADERS BOOST_BIND_GLOBAL_PLACEHOLDERS BOOST_NO_CXX11_SCOPED_ENUMS)
target_compile_options(tf_valhalla PRIVATE -ffunction-sections -fdata-sections -fvisibility=hidden)
target_include_directories(tf_valhalla PRIVATE
  "${VALHALLA_SRC}" "${VALHALLA_SRC}/valhalla" "${VALHALLA_SRC}/src"
  "${VALHALLA_OUT}/src" "${VALHALLA_OUT}/src/valhalla"
  "${VALHALLA_SRC}/third_party/rapidjson/include" "${VALHALLA_SRC}/third_party/date/include"
  "${VALHALLA_SRC}/third_party/unordered_dense/include"
  "${BOOST_INCLUDE}" "${PROTOBUF_OUT}/include")
