/* Stub replacing the CMake-generated export header: we consume the system
   libtaskmanager.so.6 (same v6.6.5 ABI), so everything is a plain import. */
#pragma once
#define TASKMANAGER_EXPORT __attribute__((visibility("default")))
#define TASKMANAGER_NO_EXPORT __attribute__((visibility("hidden")))
#define TASKMANAGER_DEPRECATED __attribute__((__deprecated__))
#define TASKMANAGER_DEPRECATED_EXPORT TASKMANAGER_EXPORT TASKMANAGER_DEPRECATED
#define TASKMANAGER_DEPRECATED_NO_EXPORT TASKMANAGER_NO_EXPORT TASKMANAGER_DEPRECATED
