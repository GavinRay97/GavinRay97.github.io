---
title: "Building a high-performance database buffer pool in Zig using io_uring's new fixed-buffer mode"
date: '2022-10-14'
tags: ['database', 'zig', 'io_uring', 'performance', 'linux']
draft: false
summary: "In this post, we will explore how to build a high-performance database buffer pool in Zig using io_uring's new fixed-buffer mode."
images: []
---

<TOCInline toc={props.toc} indentDepth={2} asDisclosure />

---

# Preface

A few days ago, I had a shower thought:

<blockquote className="twitter-tweet"><p lang="en" dir="ltr">Shower thought:<br/>io_uring lets you pre-allocate and register a pool of buffers to use for ops, instead of providing them on each call<br/>Why not implement a DB buffer pool where the bufs are registered w/ io_uring?<br/>Then you don&#39;t need to pass buffers between the BP + disk manager <a href="https://t.co/LDnlO4EWvp">pic.twitter.com/LDnlO4EWvp</a></p>&mdash; Gavin Ray (@GavinRayDev) <a href="https://twitter.com/GavinRayDev/status/1579611928435240960?ref_src=twsrc%5Etfw">October 10, 2022</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charSet="utf-8"></script>

This post is the result of exploring that thought.

# Introduction

`io_uring` is a new Linux kernel API that allows applications to submit I/O requests to the kernel and receive completion events for those requests. It is a much more efficient alternative to the traditional `epoll`/`kqueue`-based asynchronous I/O model. In this post, we will explore how to build a high-performance database buffer pool in Zig using `io_uring`'s new fixed-buffer mode.

I chose Zig to implement this because:

- I'm not very familiar with it, and it was a good opportunity to learn
- It turns out that Zig has a nice `io_uring` API baked into `std`, which makes it a natural fit for this project

[Incidentally, the author of said API is the founder of TigerBeetle DB.](https://news.ycombinator.com/item?id=33193229)

# What the hell is a buffer pool?

A database buffer pool is essentially a cache of database pages (chunks of fixed-size bytes). When a database page is requested, it is first checked if it is already in the buffer pool. If it is, then the page is returned immediately. If it is not, then the page is read from disk and added to the buffer pool. If the buffer pool is full, then a page is evicted from the buffer pool to make room for the new page.

The buffer pool is a critical component of a database. It is responsible for reducing the number of disk reads and writes. It also reduces the amount of memory required to store the database pages. In this post, we will explore how to build a high-performance buffer pool in Zig using `io_uring`'s new fixed-buffer mode.

# So how are they usually built?

The traditional way to architect a buffer pool is to have it function similar to an arena allocator. A fixed amount of memory is allocated up-front when the buffer pool is created, and when reading/writing pages to disk, pointers/references to fixed-size chunks of that memory are passed to the disk manager. The disk manager then reads/writes the pages to disk, and the buffer pool is responsible for updating the page's metadata (e.g. dirty bit, reference count, etc).

When the disk manager performs I/O operations, these generally block the calling thread. This means that the buffer pool must be able to handle multiple I/O operations at the same time. This is usually done by having a thread pool that is responsible for performing the I/O operations. The buffer pool then passes the I/O operations to the thread pool, and the thread pool is responsible for performing the I/O operations and notifying the buffer pool when the I/O operations complete.

This architecture is simple and easy to understand, but it has a few drawbacks:

- Page reads/writes are performed synchronously, which means that the buffer pool must wait for the disk manager to complete the I/O operation before it can return the page to the caller.
- There is non-insignificant overhead in spawning OS threads
- The buffer pool has to explicitly pass pointers to the pages to the disk manager, which means that the buffer pool must keep track of the page's location in memory.

# Tossing io_uring in the mix

The primary appeal of `io_uring` is that it allows applications to submit I/O requests to the kernel asynchronously, and receive completion events for those requests. This doesn't make reading/writing pages to disk necessarily faster, but it does increase potential I/O throughput by allowing the buffer pool to submit multiple I/O requests to the kernel at the same time.

One of the more recent features of `io_uring` is the ability to pre-allocate and register a pool of buffers to use for I/O operations. This means that the buffer pool can pre-allocate a pool of memory, and then register that memory with `io_uring`. When the buffer pool wants to read/write a page to disk, it can simply pass the index to a buffer in the pool to the disk manager. The disk manager can then perform the I/O operation using that buffer, and the buffer pool will (optionally) receive a completion event when the I/O operation completes.

- https://unixism.net/loti/tutorial/fixed_buffers.html

The performance implications of this can be significant. Although experimentally, this appears to be dependent on the queue depth, see:

- https://00pauln00.medium.com/io-uring-fixed-buffer-versus-non-fixed-buffer-performance-comparison-9fd506de6829

> Graph from the above article, showing the performance of fixed-buffer mode vs standard mode:
> ![io_uring fixed buffer performance](https://miro.medium.com/max/640/1*HcfArBVuLNrgg1oPmWDRHA.png)

It seems reasonable that if you're building a database, and you want it to _**GO VERY FAST**_, you probably want to:

- Use `io_uring` to perform I/O operations
- Pre-register your buffer pool memory with `io_uring` using fixed-buffer mode
- Implement a concurrent design model to take advantage of `io_uring`'s asynchronous nature

As it turns out, some very smart people have recently done this. See the TUM papers on Umbra's design:

- [What Are You Waiting For? Use Coroutines for Asynchronous I/O to Hide I/O Latencies and Maximize the Read Bandwidth](https://db.in.tum.de/~fent/papers/coroutines.pdf)

That last bit is a topic for another, much longer post. For now, we will focus on the first two points.

# Holy shit this is so much text just show me the code

Ok, fine. Here's the code:

We'll start with the Disk Manager, because you need that bit first and it's where the `io_uring` meat is.

## Disk Manager Implementation

```zig
const std = @import("std");

const PAGE_SIZE = 4096;
const BUFFER_POOL_NUM_PAGES = 1000;

const IoUringDiskManager = struct {
    file: std.fs.File,
    io_uring: std.os.linux.IO_Uring,
    // iovec array filled with pointers to buffers from the buffer pool.
    // These are registered with the io_uring and used for reads and writes.
    iovec_buffers: []std.os.iovec,

    const Self = @This();

    pub fn init(file: std.fs.File, buffer_pool_buffers: *[BUFFER_POOL_NUM_PAGES][PAGE_SIZE]u8) !Self {
        const io_uring_queue_depth = 1024;
        const io_uring_setup_flags = 0;
        var io_uring = try std.os.linux.IO_Uring.init(io_uring_queue_depth, io_uring_setup_flags);

        // register buffers for read/write
        var iovec_buffers = try std.heap.page_allocator.alloc(std.os.iovec, BUFFER_POOL_NUM_PAGES);
        errdefer std.heap.page_allocator.free(iovec_buffers);
        for (buffer_pool_buffers) |*buffer, i| {
            iovec_buffers[i] = std.os.iovec{
                .iov_base = buffer,
                .iov_len = PAGE_SIZE,
            };
        }
        try io_uring.register_buffers(iovec_buffers);

        return Self{
            .file = file,
            .io_uring = io_uring,
            .iovec_buffers = iovec_buffers,
        };
    }

    pub fn deinit(self: *Self) void {
        self.io_uring.deinit();
        self.file.close();
    }

    pub fn read_page(self: *Self, frame_index: usize) !void {
        std.debug.print("[IoUringDiskManager] read_page: frame_index={}\n", .{frame_index});
        const iovec = &self.iovec_buffers[frame_index];
        const userdata = 0x0;
        const fd = self.file.handle;
        const offset = frame_index * PAGE_SIZE;
        const buffer_index: u16 = @intCast(u16, frame_index);
        _ = try self.io_uring.read_fixed(userdata, fd, iovec, offset, buffer_index);
        _ = try self.io_uring.submit();
    }

    pub fn write_page(self: *Self, frame_index: usize) !void {
        std.debug.print("[IoUringDiskManager] write_page: frame_index={}\n", .{frame_index});
        const iovec = &self.iovec_buffers[frame_index];
        const userdata = 0x0;
        const fd = self.file.handle;
        const offset = frame_index * PAGE_SIZE;
        const buffer_index: u16 = @intCast(u16, frame_index);
        _ = try self.io_uring.write_fixed(userdata, fd, iovec, offset, buffer_index);
        _ = try self.io_uring.submit();
    }
};

test "io_uring disk manager" {
    const file = try std.fs.cwd().createFile("test.db", .{ .truncate = true, .read = true });
    defer file.close();

    // Is this allocation pattern right? I'm not sure, but it passes the tests.
    var buffer_pool_buffers = [_][PAGE_SIZE]u8{undefined} ** BUFFER_POOL_NUM_PAGES;
    var disk_manager = try IoUringDiskManager.init(file, &buffer_pool_buffers);

    const page_id: u32 = 0;
    // Modify the page in the buffer pool.
    const page = &buffer_pool_buffers[page_id];
    page[0] = 0x42;
    // Submit the write to the io_uring.
    try disk_manager.write_page(page_id);
    _ = try disk_manager.io_uring.submit_and_wait(1);

    // Read the page from disk (modifies the backing buffer)
    try disk_manager.read_page(page_id);
    // Wait for the read to complete.
    _ = try disk_manager.io_uring.submit_and_wait(1);
    // Verify that the page was read correctly.
    try std.testing.expectEqualSlices(u8, &[_]u8{0x42}, buffer_pool_buffers[page_id][0..1]);
}
```

Breaking down what's going on here:

- We have a struct, `IoUringDiskManager`, that wraps a `std.fs.File` and an `std.os.linux.IO_Uring` instance.
  - When we initialize it, we create the `IO_Uring` instance and register the buffer pool buffers with it.
  - The `io_uring` queue depth is set to 1024 (the maximum the kernel allows is 4096).
  - The `io_uring` setup flags are set to 0, which means that we are using the default setup flags.
- The implementation of `read_page` and `write_page` delegate to the `io_uring` fixed-buffer read/write functionality
  - These queue but do not submit the requests
  - We want to retain the ability to submit them ourselves, in case we want to batch, link, or otherwise manipulate the requests

Here's the definition of `read_fixed` from `std/os/linux/io_uring.zig`.
You can extrapolate this for `write_fixed` and `readv_fixed` and `writev_fixed`:

```zig
/// Queues (but does not submit) an SQE to perform a IORING_OP_READ_FIXED.
/// The `buffer` provided must be registered with the kernel by calling `register_buffers` first.
/// The `buffer_index` must be the same as its index in the array provided to `register_buffers`.
///
/// Returns a pointer to the SQE so that you can further modify the SQE for advanced use cases.
pub fn read_fixed(
    self: *IO_Uring,
    user_data: u64,
    fd: os.fd_t,
    buffer: *os.iovec,
    offset: u64,
    buffer_index: u16,
) !*linux.io_uring_sqe {
    const sqe = try self.get_sqe();
    io_uring_prep_read_fixed(sqe, fd, buffer, offset, buffer_index);
    sqe.user_data = user_data;
    return sqe;
}
```

Finally, let's build the buffer pool on top of this.

## Buffer Pool Manager Implementation

```zig
pub const IoUringBufferPoolManager = struct {
    // Disk Manager is responsible for reading and writing pages to disk.
    disk_manager: *IoUringDiskManager,
    // Frames is an array of PAGE_SIZE bytes of memory, each representing a page.
    frames: *[BUFFER_POOL_NUM_PAGES][PAGE_SIZE]u8,
    // Page table is a mapping from page id to frame index in the buffer pool
    page_id_to_frame_map: std.AutoHashMap(u32, usize),
    // Free list is a list of free frames in the buffer pool
    free_list: std.ArrayList(usize),

    const Self = @This();

    pub fn init(frames: *[BUFFER_POOL_NUM_PAGES][PAGE_SIZE]u8, disk_manager: *IoUringDiskManager) !Self {
        var page_map = std.AutoHashMap(u32, usize).init(std.heap.page_allocator);
        errdefer page_map.deinit();

        var free_list = std.ArrayList(usize).init(std.heap.page_allocator);
        errdefer free_list.deinit();

        // Statically allocate the memory, prevent resizing/re-allocating.
        try page_map.ensureTotalCapacity(BUFFER_POOL_NUM_PAGES);
        try free_list.ensureTotalCapacity(BUFFER_POOL_NUM_PAGES);

        // All frames are free at the beginning.
        for (frames) |_, i| {
            try free_list.append(i);
        }

        return Self{
            .disk_manager = disk_manager,
            .frames = frames,
            .page_id_to_frame_map = page_map,
            .free_list = free_list,
        };
    }

    pub fn deinit(self: *Self) void {
        self.page_id_to_frame_map.deinit();
        self.free_list.deinit();
    }

    pub fn get_page(self: *Self, page_id: u32) !*[PAGE_SIZE]u8 {
        std.debug.print("[IoUringBPM] get_page: page_id={}\n", .{page_id});

        // If the page is already in the buffer pool, return it.
        if (self.page_id_to_frame_map.contains(page_id)) {
            std.debug.print("[IoUringBPM] get_page: page_id={} is already in the buffer pool\n", .{page_id});
            const frame_index = self.page_id_to_frame_map.get(page_id).?;
            return &self.frames[frame_index];
        }
        std.debug.print("[IoUringBPM] get_page: page_id={} is not in the buffer pool\n", .{page_id});

        // Check if there are any free pages in the buffer pool.
        if (self.free_list.items.len == 0) {
            // TODO: Evict a page from the buffer pool.
            return error.NoFreePages;
        }

        // If the page is not in the buffer pool, read it from disk.
        const frame_index = self.free_list.pop();
        try self.disk_manager.read_page(frame_index);
        _ = try self.disk_manager.io_uring.submit_and_wait(1);
        std.debug.print("[IoUringBPM] get_page: page_id={} read from disk\n", .{page_id});

        // Add the page to the page table.
        std.debug.print("[IoUringBPM] get_page: page_id={} added to page table at frame_index={}\n", .{ page_id, frame_index });
        self.page_id_to_frame_map.put(page_id, frame_index) catch unreachable;

        // Return the page.
        return &self.frames[frame_index];
    }

    pub fn flush_page(self: *Self, page_id: u32) !void {
        if (self.page_id_to_frame_map.contains(page_id)) {
            const frame_index = self.page_id_to_frame_map.get(page_id).?;
            try self.disk_manager.write_page(frame_index);
            _ = try self.disk_manager.io_uring.submit_and_wait(1);
        }
    }
};

test "io_uring buffer pool manager" {
    const file = try std.fs.cwd().createFile("test.db", .{ .truncate = true, .read = true });
    defer file.close();

    var buffer_pool_buffers = [_][PAGE_SIZE]u8{undefined} ** BUFFER_POOL_NUM_PAGES;
    var disk_manager = try IoUringDiskManager.init(file, &buffer_pool_buffers);
    var buffer_pool_manager = try IoUringBufferPoolManager.init(&buffer_pool_buffers, &disk_manager);

    const page_id: u32 = 0;
    // We expect the page to be read into frame 999, since we have 1k frames and use .pop() to get the next free frame.
    const expected_frame_index = 999;

    // Modify the page in the buffer pool (page=0, frame=999).
    var page = try buffer_pool_manager.get_page(page_id);
    page[0] = 0x42;

    // Flush the page to disk.
    try buffer_pool_manager.flush_page(page_id);
    _ = try disk_manager.io_uring.submit_and_wait(1);

    // Read the page from disk (frame=999).
    try disk_manager.read_page(expected_frame_index);
    // Wait for the read to complete.
    _ = try disk_manager.io_uring.submit_and_wait(1);
    // Verify that the page was read correctly.
    const updated_frame_buffer = &buffer_pool_buffers[expected_frame_index];
    try std.testing.expectEqualSlices(u8, &[_]u8{0x42}, updated_frame_buffer[0..1]);
}
```
