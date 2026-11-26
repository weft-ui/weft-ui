# hermesc flags of Weft bundles; keep them in sync with HERMESC_FLAGS in
# packages/vite/src/native.ts.
set(WEFT_HERMESC_FLAGS -O -emit-binary -Xes6-block-scoping -Xasync-generators -w)

# Kernel tests: each JS file under js/ is compiled by the hermesc of the
# Hermes subproject and run by one test case of weft_core_tests.
file(GLOB js_sources CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/js/*.js)
if(NOT CMAKE_SYSTEM_NAME STREQUAL "Linux")
  list(REMOVE_ITEM js_sources ${CMAKE_CURRENT_SOURCE_DIR}/js/unicode-linux.js)
endif()
set(bundles)
foreach(source IN LISTS js_sources)
  get_filename_component(name ${source} NAME_WE)
  set(bundle ${CMAKE_CURRENT_BINARY_DIR}/js/${name}.hbc)
  add_custom_command(OUTPUT ${bundle}
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/js
    COMMAND hermesc ${WEFT_HERMESC_FLAGS} -out=${bundle} ${source}
    DEPENDS ${source} hermesc
    VERBATIM)
  list(APPEND bundles ${bundle})
endforeach()
add_custom_target(weft_core_test_bundles DEPENDS ${bundles})

get_filename_component(repo ${PROJECT_SOURCE_DIR}/../.. ABSOLUTE)

add_executable(weft_core_tests kernel_test.cpp)
target_compile_definitions(weft_core_tests PRIVATE WEFT_CORPUS_DIR="${repo}/protocol/corpus")
# Only the C ABI crosses the boundary of a shared kernel. Compile the C++
# ops helper into the test hosts, and place Windows DLLs beside each executable.
function(weft_test_host target)
  target_link_libraries(${target} PRIVATE weft::core)
  if(MSVC)
    target_compile_options(${target} PRIVATE /utf-8)
  endif()
  if(WEFT_CORE_SHARED)
    target_sources(${target} PRIVATE ${PROJECT_SOURCE_DIR}/src/ops.cpp)
  endif()
  if(WIN32 AND WEFT_CORE_SHARED)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
        $<TARGET_RUNTIME_DLLS:${target}> $<TARGET_FILE_DIR:${target}>
      COMMAND_EXPAND_LISTS
      VERBATIM)
  endif()
endfunction()
weft_test_host(weft_core_tests)
add_dependencies(weft_core_tests weft_core_test_bundles)
foreach(name timers microtasks console text unicode calls environment session refused protocol stable_rows ops corpus bounds)
  add_test(NAME core.${name} COMMAND weft_core_tests ${CMAKE_CURRENT_BINARY_DIR}/js ${name})
endforeach()

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  function(weft_unicode_locale name expected lc_all lc_messages lang)
    if(NOT name STREQUAL "core.unicode")
      add_test(NAME ${name} COMMAND weft_core_tests ${CMAKE_CURRENT_BINARY_DIR}/js unicode)
    endif()
    set_tests_properties(${name} PROPERTIES ENVIRONMENT
      "WEFT_UNICODE_EXPECTED=${expected};TZ=UTC;LC_ALL=${lc_all};LC_MESSAGES=${lc_messages};LANG=${lang}")
  endfunction()
  weft_unicode_locale(core.unicode root "C.UTF-8" "tr-TR" "tr-TR")
  weft_unicode_locale(core.unicode.zh pinyin "" "zh_CN.UTF-8@euro" "tr-TR")
  weft_unicode_locale(core.unicode.tr turkish "tr_TR@modifier" "zh_CN" "C")
  weft_unicode_locale(core.unicode.lang turkish "" "" "tr-TR")
  weft_unicode_locale(core.unicode.script serbian-latin "sr_Latn_RS.UTF-8" "" "")
  weft_unicode_locale(core.unicode.posix root "POSIX" "" "tr-TR")
  weft_unicode_locale(core.unicode.invalid root "not a locale" "" "tr-TR")
  weft_unicode_locale(core.unicode.empty root "" "" "")
endif()

# Protocol conformance: tests/conformance/native/build.ts bundles every fixture
# with @weft-ui/vite (including its hermesc step), and weft_conformance runs
# each bundle against a C++ renderer, comparing the ops log with the golden
# file the JS headless renderer wrote.
if(WEFT_CONFORMANCE)
  find_program(WEFT_NODE node REQUIRED)
  set(out ${CMAKE_CURRENT_BINARY_DIR}/conformance)
  add_executable(weft_conformance conformance.cpp)
  weft_test_host(weft_conformance)
  add_test(NAME conformance.build COMMAND ${WEFT_NODE} ${repo}/tests/conformance/native/build.ts ${out})
  # Use this kernel's compiler, even if the host needs a separately packaged hermesc.
  set_tests_properties(conformance.build PROPERTIES
    FIXTURES_SETUP conformance_bundles
    ENVIRONMENT "WEFT_HERMESC=$<TARGET_FILE:hermesc>")
  # Match the fixtures skipped by the Linux bundle builder during native rollout.
  set(pending_file ${repo}/tests/conformance/native/pending.json)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${pending_file})
  file(READ ${pending_file} pending_json)
  string(JSON pending_count LENGTH "${pending_json}")
  set(pending)
  if(pending_count GREATER 0)
    math(EXPR last_pending "${pending_count} - 1")
    foreach(index RANGE ${last_pending})
      string(JSON name GET "${pending_json}" ${index})
      list(APPEND pending "${name}")
    endforeach()
  endif()
  file(GLOB goldens CONFIGURE_DEPENDS ${repo}/tests/conformance/golden/*.ops)
  foreach(golden IN LISTS goldens)
    get_filename_component(name ${golden} NAME_WE)
    if(name IN_LIST pending)
      continue()
    endif()
    add_test(NAME conformance.${name} COMMAND weft_conformance ${out}/${name} ${golden})
    set_tests_properties(conformance.${name} PROPERTIES FIXTURES_REQUIRED conformance_bundles)
  endforeach()
endif()
