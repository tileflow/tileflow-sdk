# Cross builds of protobuf ship no protoc: point protobuf::protoc at the host build.
if(NOT TARGET protobuf::protoc)
  add_executable(protobuf::protoc IMPORTED GLOBAL)
  set_target_properties(protobuf::protoc PROPERTIES IMPORTED_LOCATION "${Protobuf_PROTOC_EXECUTABLE}")
endif()
