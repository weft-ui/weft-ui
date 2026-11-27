cmake_minimum_required(VERSION 3.28)
project(weft_linux LANGUAGES C CXX)

option(WEFT_LINUX_TESTS "Build the shell's unit tests" OFF)

# The Linux shell, built from source by every app: the weft/CMakeLists.txt
# that @weft-ui/vite generates adds this directory and calls weft_views(),
# and the app's CMakeLists.txt calls weft_app() for each executable.
# The kernel comes prebuilt from build-core.sh.

find_package(PkgConfig REQUIRED)
# GtkSectionModel is available from GTK 4.12.
pkg_check_modules(WEFT_DEPS REQUIRED IMPORTED_TARGET gtk4>=4.12 libsoup-3.0 json-glib-1.0 fontconfig pangocairo pangoft2)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64|amd64)$")
  set(weft_arch x64)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64|ARM64)$")
  set(weft_arch arm64)
else()
  message(FATAL_ERROR "weft: unsupported architecture ${CMAKE_SYSTEM_PROCESSOR}")
endif()
set(weft_core ${CMAKE_CURRENT_LIST_DIR}/build/linux-${weft_arch}/libweft_core.so)
if(NOT EXISTS ${weft_core})
  message(FATAL_ERROR "weft: the native kernel for Linux ${weft_arch} is missing (${weft_core}); "
    "build it with native/linux/build-core.sh")
endif()
# The package ships the op reader and headers; a workspace build uses the originals.
set(weft_core_source ${CMAKE_CURRENT_LIST_DIR}/core)
if(NOT EXISTS "${weft_core_source}/include")
  set(weft_core_source ${CMAKE_CURRENT_LIST_DIR}/../core)
endif()
add_library(weft_core_shared SHARED IMPORTED GLOBAL)
set_target_properties(weft_core_shared PROPERTIES
  IMPORTED_LOCATION ${weft_core}
  INTERFACE_INCLUDE_DIRECTORIES ${weft_core_source}/include
  INTERFACE_COMPILE_DEFINITIONS WEFT_CORE_SHARED)

# Only the kernel's C ABI crosses the shared library, so the shell compiles
# the C++ ops decoder itself.
add_library(weft_linux STATIC
  src/appearance.cpp
  src/assets.cpp
  src/color.cpp
  src/container.cpp
  src/controls.cpp
  src/elements.cpp
  src/frame.cpp
  src/layout.cpp
  src/list.cpp
  src/platform.cpp
  src/scope.cpp
  src/session.cpp
  src/texture_cache.cpp
  src/ui.cpp
  ${weft_core_source}/src/ops.cpp
)
add_library(weft::linux ALIAS weft_linux)
target_include_directories(weft_linux PUBLIC include)
target_compile_features(weft_linux PUBLIC cxx_std_20)
target_link_libraries(weft_linux PUBLIC PkgConfig::WEFT_DEPS weft_core_shared)
install(FILES include/weft/gtk.hpp include/weft/elements.hpp include/weft/layout.hpp DESTINATION include/weft)

# Vite configures each build. Replace the staged tree so removed assets do
# not linger; copy the directory as a whole to preserve arbitrary font names.
function(weft_copy_assets assets destination)
  file(REMOVE_RECURSE "${destination}")
  if(IS_DIRECTORY "${assets}")
    file(COPY "${assets}/" DESTINATION "${destination}")
  endif()
endfunction()

if(WEFT_LINUX_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

# The app's generated views, bytecode and assets (called by weft/CMakeLists.txt).
function(weft_views views bundle assets)
  add_library(weft_views STATIC ${views})
  target_link_libraries(weft_views PUBLIC weft::linux)
  set_property(GLOBAL PROPERTY WEFT_BUNDLE ${bundle})
  weft_copy_assets("${assets}" "${CMAKE_BINARY_DIR}/weft/assets")
endfunction()

# Makes `target` a Weft app executable: it links the generated views and is
# written to the top of the build directory, next to the kernel library
# (found through the `$ORIGIN` run path) and weft/bundle.hbc.
function(weft_app target)
  target_link_libraries(${target} PRIVATE weft_views)
  set_target_properties(${target} PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")
  if(NOT TARGET weft_files)
    get_property(bundle GLOBAL PROPERTY WEFT_BUNDLE)
    get_target_property(core weft_core_shared IMPORTED_LOCATION)
    add_custom_command(
      OUTPUT ${CMAKE_BINARY_DIR}/weft/bundle.hbc ${CMAKE_BINARY_DIR}/libweft_core.so
      COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_BINARY_DIR}/weft
      COMMAND ${CMAKE_COMMAND} -E copy ${bundle} ${CMAKE_BINARY_DIR}/weft/bundle.hbc
      COMMAND ${CMAKE_COMMAND} -E copy ${core} ${CMAKE_BINARY_DIR}/libweft_core.so
      DEPENDS ${bundle} ${core}
      VERBATIM)
    add_custom_target(weft_files DEPENDS ${CMAKE_BINARY_DIR}/weft/bundle.hbc ${CMAKE_BINARY_DIR}/libweft_core.so)
  endif()
  add_dependencies(${target} weft_files)
endfunction()
