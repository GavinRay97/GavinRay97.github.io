---
title: 'Bypassing noexec with memfd_create(2)'
date: '2026-02-29'
tags: ['linux', 'c', 'systems-programming', 'java']
draft: false
summary: "Using Linux's memfd_create(2) syscall to load shared libraries and execute binaries entirely from memory, bypassing noexec restrictions without ever touching disk."
images: ['/static/images/memfd-create-readonly-fs.svg']
---

Some time ago, I saw a post on the `/r/java` subreddit, asking about **"loading a shared lib from .jar directly into memory"**:
https://reddit.com/r/java/comments/15lcwil/load_shared_lib_from_jar_directly_into_memory/

Despite claims that the above is/should be impossible, it CAN be done.

https://man7.org/linux/man-pages/man2/memfd_create.2.html

```c
NAME
       memfd_create - create an anonymous file
LIBRARY
       Standard C library (libc, -lc)
SYNOPSIS
       #define _GNU_SOURCE         /* See feature_test_macros(7) */
       #include <sys/mman.h>

       int memfd_create(const char *name, unsigned int flags);
```

Linux has a syscall, `memfd_create(2)`, that allows creating something like a virtual file descriptor.
You can use the FD it returns just like any other, but it doesn't interact with the filesystem underneath.

The reason this works is that `memfd` file descriptors are backed by anonymous pages in `tmpfs`. When you call `fexecve()` or `dlopen()` on one, the kernel maps those pages into the process's address space directly -- it never consults the `noexec` flag of any mounted filesystem, because there IS no mounted filesystem involved. The execution permission is determined by the `memfd`'s own file seals and the process's ability to map executable pages, rather than by mount options.

The general idea is something like:

1. Create in-memory file descriptor
2. Write the bytes of an application or library into the file descriptor
3. Run the application or load the library

Here's a minimal proof of concept, for both an ELF binary and a shared library.

```
❯ tree .
.
├── Makefile
├── example-library.c     # Shared lib exporting add() for testing
├── example-program.c     # Normal ELF binary that links against libexample-library.so
├── memfd-exec.c          # Loads an entire ELF binary into a memfd and executes it with fexecve()
└── memfd-loader.c        # Loads an .so into a memfd and calls its symbols via dlopen()/dlsym()
```

```makefile
CC      = gcc
CFLAGS  = -Wall -Wextra -O2

all: example-library.so libexample-library.so example-program memfd-loader memfd-exec

example-library.so: example-library.c
    $(CC) $(CFLAGS) -shared -fPIC -o $@ $<

libexample-library.so: example-library.so
    ln -sf $< $@

example-program: example-program.c libexample-library.so
    $(CC) $(CFLAGS) -o $@ $< -L. -lexample-library -Wl,-rpath,'$ORIGIN'

memfd-loader: memfd-loader.c example-library.so
    $(CC) $(CFLAGS) -o $@ $< -ldl

memfd-exec: memfd-exec.c example-program
    $(CC) $(CFLAGS) -o $@ $<

clean:
    rm -f example-library.so libexample-library.so example-program memfd-loader memfd-exec

.PHONY: all clean
```

```c
// example-library.c
int add(int a, int b) {
    return a + b;
}
```

```c
// example-program.c
#include <stdio.h>

int add(int a, int b);

int main() {
    printf("%d\n", add(3, 4));
    return 0;
}
```

```c
// memfd-loader.c
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>

int main() {
    // 1. Read the .so bytes
    int lib = open("example-library.so", O_RDONLY);
    struct stat st;
    fstat(lib, &st);
    char buf[st.st_size];
    read(lib, buf, st.st_size);
    close(lib);

    // 2. Create an anonymous in-memory file descriptor
    int memfd = memfd_create("example-library.so", MFD_CLOEXEC);

    // 3. Write the library bytes into it
    write(memfd, buf, st.st_size);

    // 4. dlopen via /proc/self/fd/<N> - no filesystem path needed
    char path[64];
    snprintf(path, sizeof(path), "/proc/self/fd/%d", memfd);
    void *handle = dlopen(path, RTLD_NOW);
    if (!handle) {
        fprintf(stderr, "dlopen: %s\n", dlerror());
        return 1;
    }

    // 5. Resolve + call the symbol
    int (*add)(int, int) = dlsym(handle, "add");
    printf("add(3, 4) = %d\n", add(3, 4));

    dlclose(handle);
    close(memfd);
    return 0;
}
```

```c
// memfd-exec.c
#define _GNU_SOURCE
#include <stdio.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

int main() {
    // 1. Read the binary bytes
    int bin = open("example-program", O_RDONLY);
    struct stat st;
    fstat(bin, &st);
    char buf[st.st_size];
    read(bin, buf, st.st_size);
    close(bin);

    // 2. Create anonymous in-memory fd
    int memfd = memfd_create("example-program", MFD_CLOEXEC);

    // 3. Write binary into it
    write(memfd, buf, st.st_size);

    // 4. Execute directly from the fd
    //    Note: fexecve replaces the process image, so $ORIGIN in any rpath
    //    would resolve to /proc/self/fd/ which doesn't contain our .so.
    //    We use LD_LIBRARY_PATH as a simple workaround.
    char *argv[] = { "example-program", NULL };
    char *envp[] = { "LD_LIBRARY_PATH=.", NULL };
    printf("Executing example-program from memfd...\n");
    fexecve(memfd, argv, envp);

    perror("fexecve");
    return 1;
}
```

You should be able to run the ELF binary or invoke the shared lib using the `memfd` example apps:

First, to prove I'm not pulling tricks here...

```bash
projects/memory-loader-example via C v13.3.0-gcc
❯ grep ' /proc ' /proc/mounts | grep -q 'noexec' && echo "noexec is enabled" || echo "noexec is not enabled"
noexec is enabled

projects/memory-loader-example via C v13.3.0-gcc
❯ grep ' /proc ' /proc/mounts | grep 'noexec'
proc /proc proc rw,nosuid,nodev,noexec,noatime 0 0
```

And with that, we confirm:

```bash
projects/memory-loader-example via C v13.3.0-gcc
❯ ./example-program
7

projects/memory-loader-example via C v13.3.0-gcc
❯ ./memfd-loader
add(3, 4) = 7

projects/memory-loader-example via C v13.3.0-gcc
❯ ./memfd-exec
Executing example-program from memfd...
7
```

As someone mentions in the Reddit thread, there are patches for both Chrome and the kernel to prevent this behavior:

- https://issuetracker.google.com/issues/40054993
- https://lore.kernel.org/kernel-hardening/20201203173118.379271-1-mic@digikod.net/T/

It's worth noting that as of kernel 6.3, the `vm.memfd_noexec` sysctl was introduced to restrict executable memfds. At level 1, `memfd_create()` without `MFD_NOEXEC_SEAL` emits a warning; at level 2, it's denied outright. Most distros still ship with this at 0 (unrestricted), but hardened configs and container runtimes are starting to lock it down.

# Addendum: Solving the original problem

In case you actually want to accomplish the same thing as the original /r/java user (loading a native library from memory without extracting it to disk) the following does so using JDK 23's Foreign Function & Memory (FFM) API to call `memfd_create` and `dlopen`/`dlsym` directly, with no JNI involved:

```java
// java --enable-preview --source 23 --enable-native-access=ALL-UNNAMED LoadFromMemory.java < example-library.so
public static void main(String[] args) throws Throwable {
    ByteBuffer sharedLibContents = ByteBuffer.wrap(System.in.readAllBytes());

    Arena arena = Arena.ofAuto();
    Linker linker = Linker.nativeLinker();
    SymbolLookup lookup = linker.defaultLookup();

    // Get "memfd_create" handle from libc
    MethodHandle memfdCreate = linker.downcallHandle(
            lookup.find("memfd_create").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.ADDRESS, ValueLayout.JAVA_INT));

    // Create memory file descriptor
    int fd = (int) memfdCreate.invokeExact(arena.allocateFrom("example-library"), 0);

    // Write shared library to memory file descriptor
    String fdPath = "/proc/self/fd/" + fd;
    try (var fos = new FileOutputStream(fdPath)) {
        fos.getChannel().write(sharedLibContents);
    }

    // Get "dlopen" handle from libc
    MethodHandle dlopen = linker.downcallHandle(
            lookup.find("dlopen").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.ADDRESS, ValueLayout.ADDRESS, ValueLayout.JAVA_INT));

    // Load shared library from memfd
    MemorySegment handle = (MemorySegment) dlopen.invokeExact(arena.allocateFrom(fdPath), 1);

    // Get "dlsym" handle and resolve "add" function
    MethodHandle dlsym = linker.downcallHandle(
            lookup.find("dlsym").orElseThrow(),
            FunctionDescriptor.of(ValueLayout.ADDRESS, ValueLayout.ADDRESS, ValueLayout.ADDRESS));

    MemorySegment addAddr = (MemorySegment) dlsym.invokeExact(handle, arena.allocateFrom("add"));
    MethodHandle add = linker.downcallHandle(addAddr,
            FunctionDescriptor.of(ValueLayout.JAVA_INT, ValueLayout.JAVA_INT, ValueLayout.JAVA_INT));

    // Invoke "add" function
    int result = (int) add.invokeExact(1, 2);
    System.out.println("1 + 2 = " + result);
}
```

---

**AI Use Disclaimer:** `claude code` was used to generate the [OpenGraph SVG image](/static/images/memfd-create-readonly-fs.svg)

No part of the prose was machine-generated. You will not find machine-written prose on this blog. I consider it deeply disrespectful.
