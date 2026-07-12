---
layout: post
title: Python List vs Linked List
description: A visual, operation-by-operation comparison of Python list and linked list with Big-O analysis, code examples, and ASCII diagrams.
date: 2026-04-10 00:10:00 +0800
media_subpath: /assets/media/2026/python-list-linkedlist
image: list-and-linkedlist.webp
published: true
categories: [python]
toc: true
tags: [python, data-structures, linked-list]
---

Python's built-in `list` and a linked list both store sequences of elements, but they work very differently under the hood. A Python list uses a contiguous array in memory, giving it instant access by index. A linked list chains individual nodes with pointers, making insertions and deletions at the front virtually free. This guide walks through every common operation side by side — with visuals, code, and Big-O — so you can see exactly where each one wins and why.

![List vs Linked List](list-vs-linkedlist.png)

## Python has no built-in linked list

Before we start, one important thing: **Python does not have a built-in linked list**. You have to build it yourself from two small classes.

**`Node`** — the individual box that holds a value and a pointer to the next node:

```python
class Node:
    def __init__(self, val):
        self.val = val
        self.next = None   # pointer to next node, starts as nothing
```

**`LinkedList`** — manages the chain of nodes. Here we only show `append` to keep it simple — the remaining methods (`pop`, `prepend`, `pop_first`, `insert`, `remove`, `get`, `find`) are each explained in their own section below.

```python
class LinkedList:
    def __init__(self):
        self.head = None
        self.tail = None

    def append(self, val):
        new_node = Node(val)        # create a new node box
        if self.tail:
            self.tail.next = new_node   # point old tail → new node
        else:
            self.head = new_node        # first node is also the head
        self.tail = new_node        # update tail to new node

    # pop, prepend, pop_first, insert, remove, get, find
    # → defined in sections below

ll = LinkedList()
ll.append(42)
ll.append(17)
ll.append(93)
# 42 → 17 → 93 → None
```

So the full picture is:

- **`Node`** — the individual box (data + next pointer). You write this yourself.
- **`LinkedList`** — manages the chain of nodes. You write this yourself. Each operation is covered step by step in the sections that follow.

> If you don't want to build one from scratch, `collections.deque` is Python's built-in doubly linked list under the hood. It gives you O(1) append and pop from **both** ends without writing any node classes.
{: .prompt-tip }

## Append — both O(1)

Python list reserves extra capacity at the back, so it just places the new element at the end directly.

```python
a = [10, 20, 30]
a.append(40)
```

```
Before:  [10][20][30][ ][ ]   ← spare capacity at back
After:   [10][20][30][40][ ]  ← placed directly, no shifting
```

Linked list just wires a new node at the tail.

```
Before:  head
          ↓
         [10] → [20] → [30] → None

After:   head
          ↓
         [10] → [20] → [30] → [40] → None
                                ↑
                          new node wired in
```

```python
def append(self, val):
    new_node = Node(val)
    if self.tail:
        self.tail.next = new_node   # O(1) — point old tail → new node
    else:
        self.head = new_node        # first node is also the head
    self.tail = new_node            # update tail to new node
```

---

## Pop from end — Python list wins O(1) vs O(n)

Python list knows the last index instantly from its stored length. Removes it directly.

```python
a = [10, 20, 30, 40]
a.pop()
```

```
Before:  [10][20][30][40]
                      ↑
               length=4, so last index is 3. Remove directly.
After:   [10][20][30]
```

Linked list has no index — must walk the entire chain to find the second-to-last node, then cut.

```
Before:  head
          ↓
         [10] → [20] → [30] → [40] → None
          walk...walk...walk...found second-to-last!

After:   head
          ↓
         [10] → [20] → [30] → None
                               ↑
                          cut here, [40] is gone
```

```python
def pop(self):
    if not self.head:
        return None
    if not self.head.next:          # single node
        val = self.head.val
        self.head = self.tail = None
        return val
    cur = self.head
    while cur.next.next:            # O(n) — walk to second-to-last
        cur = cur.next
    val = cur.next.val
    cur.next = None                 # cut the last node
    self.tail = cur                 # update tail
    return val
```

---

## Prepend — Linked list wins O(1) vs O(n)

Python list must shift every element one step right to make room at index 0.

```python
a = [10, 20, 30, 40]
a.insert(0, 99)
```

```
Before:   [10][20][30][40]

Step 1 — shift everything right to make room:
          [ ][10][20][30][40]
              ↑   ↑   ↑   ↑  each element moved one step

Step 2 — place 99 at index 0:
          [99][10][20][30][40]
```

1 million elements = 1 million shifts. O(n).

Linked list just points the new node at the old head. Done in one step.

```
Before:       head
               ↓
              [10] → [20] → [30] → [40]

After:  head
         ↓
        [99] → [10] → [20] → [30] → [40]
         ↑
    new node, just rewired
```

```python
def prepend(self, val):
    new_node = Node(val)
    if self.head:
        new_node.next = self.head   # O(1) — point new node → old head
    else:
        self.tail = new_node        # empty list, new node is also the tail
    self.head = new_node            # update head to new node
```

---

## Pop first — Linked list wins O(1) vs O(n)

Python list removes index 0 then shifts every remaining element one step left to fill the gap.

```python
a = [10, 20, 30, 40]
a.pop(0)
```

```
Before:   [10][20][30][40]

Step 1 — remove 10:
          [ ][20][30][40]

Step 2 — shift everything left to fill the gap:
          [20][30][40][ ]
            ↑   ↑   ↑   each element moved one step
```

1 million elements = 1 million shifts. O(n).

Linked list just moves the head pointer forward. Nothing shifts.

```
Before:  head
          ↓
         [10] → [20] → [30] → [40]

After:          head
                 ↓
         [10]   [20] → [30] → [40]
          ↑
         gone, head just moves forward
```

```python
def pop_first(self):
    if not self.head:
        return None
    val = self.head.val
    self.head = self.head.next      # O(1) — just move the pointer
    if not self.head:               # list is now empty
        self.tail = None
    return val
```

---

## Insert middle — both O(n)

Both must walk to find the position first. Python list then also shifts elements to make room.

```python
a = [10, 20, 30, 40]
a.insert(2, 99)
```

```
Step 1 — walk to index 2:
         [10][20][30][40]
                  ↑ found it

Step 2 — shift everything right from index 2:
         [10][20][  ][30][40]

Step 3 — place 99:
         [10][20][99][30][40]
```

Linked list still has to walk to find the position, but then just rewires — no shifting.

```
Before:  head
          ↓
         [10] → [20] → [30] → [40]
                  ↑
             walk to node before index 2

After:   head
          ↓
         [10] → [20] → [99] → [30] → [40]
                         ↑
                  inserted, no shifting
```

```python
def insert(self, index, val):
    if index == 0:                  # insert at head
        self.prepend(val)
        return
    cur = self.head
    for _ in range(index - 1):      # O(n) — walk to position
        cur = cur.next
    new_node = Node(val)
    new_node.next = cur.next        # O(1) — rewire
    cur.next = new_node
    if cur is self.tail:            # inserted at the end
        self.tail = new_node
```

---

## Remove by value — both O(n)

Both must scan through elements to find the value. No shortcut for either.

```python
a = [10, 20, 30, 40]
a.remove(30)
```

```
Before:  [10][20][30][40]
                  ↑
          scan left to right... found 30. Remove, shift left.

After:   [10][20][40]
```

Linked list scans too, but just cuts the node — no shifting.

```
Before:  head
          ↓
         [10] → [20] → [30] → [40]
                         ↑
                  found 30, rewire [20] to skip [30]

After:   head
          ↓
         [10] → [20] → [40]
```

```python
def remove(self, val):
    if not self.head:
        return
    if self.head.val == val:              # remove head
        self.head = self.head.next
        if not self.head:                 # list is now empty
            self.tail = None
        return
    cur = self.head
    while cur.next:                       # O(n) — walk to find value
        if cur.next.val == val:
            if cur.next is self.tail:     # removing the tail
                self.tail = cur
            cur.next = cur.next.next      # O(1) — rewire
            return
        cur = cur.next
```

---

## Lookup by index — Python list wins O(1) vs O(n)

Python list calculates the memory address directly using math. Instant.

```python
a = [10, 20, 30, 40]
a[2]   # → 30
```

```
address = base_address + (2 × element_size)
        = 1000 + (2 × 8)
        = 1016 → go there directly, get 30. Done. O(1)
```

Linked list has no index — must hop node by node from the head.

```
Want index 2:

head
 ↓
[10] → hop
[20] → hop
[30] → arrived at index 2. Done.

Want index 1000? Make 1000 hops. O(n).
```

```python
def get(self, index):
    cur = self.head
    for _ in range(index):  # O(n) — no shortcut
        cur = cur.next
    return cur.val
```

---

## Lookup by value — both O(n)

Both must scan every element until the value is found. No shortcut for either.

```python
a = [10, 20, 30, 40]
30 in a   # scans left to right until found
```

```
Before:  [10][20][30][40]
           ↑
          not it → not it → found 30! O(n) in worst case.
```

Linked list does the same scan, just following pointers.

```
head
 ↓
[10] → not it
[20] → not it
[30] → found! O(n) in worst case.
```

```python
def find(self, val):
    cur = self.head
    while cur:              # O(n) — scan every node
        if cur.val == val:
            return cur
        cur = cur.next
```

---

## Full picture

| Operation | Linked List | Python List |
|---|---|---|
| Append | O(1) ⚡ | O(1) ⚡ |
| Pop (end) | O(n) 🐢 | O(1) ⚡ |
| Prepend | O(1) ⚡ | O(n) 🐢 |
| Pop First | O(1) ⚡ | O(n) 🐢 |
| Insert (middle) | O(n) 🐢 | O(n) 🐢 |
| Remove (by value) | O(n) 🐢 | O(n) 🐢 |
| Lookup by Index | O(n) 🐢 | O(1) ⚡ |
| Lookup by Value | O(n) 🐢 | O(n) 🐢 |

> Linked list wins at the **front**. Python list wins at the **back and by index**. If you need both, use `collections.deque`.
