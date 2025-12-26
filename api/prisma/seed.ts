import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create delivery slots
  const slots = await Promise.all([
    prisma.deliverySlot.create({
      data: {
        startTime: '06:00',
        endTime: '08:00',
        label: 'Early Morning (6AM - 8AM)',
        isActive: true,
      },
    }),
    prisma.deliverySlot.create({
      data: {
        startTime: '08:00',
        endTime: '10:00',
        label: 'Morning (8AM - 10AM)',
        isActive: true,
      },
    }),
    prisma.deliverySlot.create({
      data: {
        startTime: '17:00',
        endTime: '19:00',
        label: 'Evening (5PM - 7PM)',
        isActive: true,
      },
    }),
  ]);
  console.log(`✅ Created ${slots.length} delivery slots`);

  // Create areas
  const areas = await Promise.all([
    prisma.area.create({
      data: {
        name: 'Sector 1-10',
        pincodes: '110001,110002,110003,110004,110005',
      },
    }),
    prisma.area.create({
      data: {
        name: 'Sector 11-20',
        pincodes: '110011,110012,110013,110014,110015',
      },
    }),
  ]);
  console.log(`✅ Created ${areas.length} areas`);


  // Create products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Full Cream Milk',
        description: 'Fresh full cream milk - 500ml packet',
        price: 30,
        unit: '500ml',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Toned Milk',
        description: 'Fresh toned milk - 500ml packet',
        price: 25,
        unit: '500ml',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Double Toned Milk',
        description: 'Fresh double toned milk - 500ml packet',
        price: 22,
        unit: '500ml',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Curd',
        description: 'Fresh curd - 400g pack',
        price: 40,
        unit: '400g',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Paneer',
        description: 'Fresh paneer - 200g pack',
        price: 80,
        unit: '200g',
        isAvailable: true,
      },
    }),
  ]);
  console.log(`✅ Created ${products.length} products`);

  // Create admin
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.admin.create({
    data: {
      email: 'admin@milksubscription.com',
      password: hashedPassword,
      name: 'System Admin',
      isActive: true,
    },
  });
  console.log(`✅ Created admin: ${admin.email}`);

  // Create a delivery boy
  const deliveryBoyPassword = await bcrypt.hash('delivery123', 10);
  const deliveryBoy = await prisma.deliveryBoy.create({
    data: {
      phone: '9876543210',
      name: 'Raju Kumar',
      password: deliveryBoyPassword,
      areaId: areas[0]!.id,
      isActive: true,
    },
  });
  console.log(`✅ Created delivery boy: ${deliveryBoy.name}`);

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
