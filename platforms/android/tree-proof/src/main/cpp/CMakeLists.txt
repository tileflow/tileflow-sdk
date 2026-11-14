cmake_minimum_required(VERSION 3.22)
project(tileflow_tree_proof)
add_library(tileflow_tree_proof SHARED tree_proof.cpp)
target_compile_features(tileflow_tree_proof PRIVATE cxx_std_17)
# Exact CustomLayerHost ABI of the pinned MapLibre Android 13.7.1; upstream headers unchanged.
target_include_directories(tileflow_tree_proof PRIVATE vendor)
target_link_libraries(tileflow_tree_proof GLESv3 log)
